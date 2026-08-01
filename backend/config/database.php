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

    private function __construct() {
        EnvironmentService::loadEnvironment(dirname(__DIR__) . '/.env');
        $this->host = EnvironmentService::get('DB_HOST', '127.0.0.1');
        $this->port = EnvironmentService::get('DB_PORT', '3306');
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
}
