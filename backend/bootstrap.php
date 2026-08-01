<?php
/**
 * Shared bootstrap for backend entry points.
 */

if (!defined('CMS_ROOT')) {
    define('CMS_ROOT', dirname(__DIR__));
}

if (!defined('BACKEND_ROOT')) {
    define('BACKEND_ROOT', __DIR__);
}

if (!defined('STORAGE_ROOT')) {
    define('STORAGE_ROOT', BACKEND_ROOT . '/storage');
}

if (!defined('UPLOADS_ROOT')) {
    define('UPLOADS_ROOT', STORAGE_ROOT . '/uploads');
}

if (!defined('LOGS_ROOT')) {
    define('LOGS_ROOT', STORAGE_ROOT . '/logs');
}
