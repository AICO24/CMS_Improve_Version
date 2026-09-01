<?php
require_once __DIR__ . '/../services/EnvironmentService.php';

class Database {
    private static $instance = null;
    private $conn;
    private $host;
    private $port;
    private $dbname;
    private $username;
    private $password;
    private $afterCommitCallbacks = [];

    private function __construct() {
        EnvironmentService::loadEnvironment(dirname(__DIR__) . '/.env');
        $this->host = EnvironmentService::get('DB_HOST', '127.0.0.1');
        $this->port = EnvironmentService::get('DB_PORT', '3307');
        $this->dbname = EnvironmentService::get('DB_NAME', 'cemetery_db');
        $this->username = EnvironmentService::get('DB_USER', 'root');
        $this->password = EnvironmentService::get('DB_PASS', '');

        $dsn = "mysql:host={$this->host};port={$this->port};dbname={$this->dbname};charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];

        try {
            $this->conn = new PDO($dsn, $this->username, $this->password, $options);
        } catch (PDOException $e) {
            throw new RuntimeException('Database connection failed: ' . $e->getMessage());
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function getConnection() {
        return $this->conn;
    }

    // Generic PDO transaction wrapper (Batch L2.1 — foundation only, nothing
    // calls this yet). Deliberately knows nothing about lots/payments/
    // schedules/AutomationEngine — it just runs $callback() between
    // beginTransaction()/commit(), rolling back and rethrowing on any
    // Throwable so the existing global error handler (backend/index.php)
    // stays the one place that turns exceptions into HTTP responses.
    //
    // Nested calls are rejected rather than silently reusing the active
    // transaction or attempting a second beginTransaction() (which PDO does
    // not support and would throw on its own): a future caller that invokes
    // this while already inside a transaction almost certainly assumed it
    // was starting a fresh atomic unit, and AutomationEngine::run() may be
    // called more than once per request (e.g. PaymentController::verify()),
    // so silently flattening nested calls into the outer transaction could
    // let a later, unrelated failure roll back work the caller believed was
    // already isolated. Failing loudly here is the safer default until a
    // real multi-step workflow actually needs nesting, at which point the
    // call sites — not this generic helper — are the right place to decide
    // how to compose their own transaction boundaries.
    public function transaction(callable $callback) {
        if ($this->conn->inTransaction()) {
            throw new RuntimeException('Database::transaction() does not support nested transactions — a transaction is already active on this connection.');
        }

        $this->conn->beginTransaction();
        try {
            $result = $callback();
            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            // Batch L2.7: anything queued during this failed transaction describes
            // a state that never actually took effect — discard it rather than
            // running it against the rolled-back result.
            $this->afterCommitCallbacks = [];
            throw $e;
        }

        // Only reached after a successful commit. Drained here (not inside the
        // try above) so a callback's own failure can never be mistaken for a
        // reason to roll back work that is already durably committed.
        $callbacks = $this->afterCommitCallbacks;
        $this->afterCommitCallbacks = [];
        foreach ($callbacks as $queuedCallback) {
            $queuedCallback();
        }

        return $result;
    }

    // Batch L2.7: lets a nested call (e.g. ScheduleController::sendEmail(), which
    // may run standalone or nested inside PaymentController::verify()'s
    // transaction via its AutomationEngine auto-confirm path) defer a non-DB side
    // effect — an email — until the transaction it happens to be running inside
    // actually commits, without that call needing to know which case it's in.
    // Mirrors the $pendingEmail pattern PaymentController::verify() already uses
    // for its own email, generalized into the one place every such caller can
    // share instead of each reimplementing the same check.
    //
    // Outside of any transaction, $callback just runs immediately — identical to
    // the pre-L2.7 behavior for a standalone caller.
    public function afterCommit(callable $callback) {
        if ($this->conn->inTransaction()) {
            $this->afterCommitCallbacks[] = $callback;
            return;
        }

        $callback();
    }
}
