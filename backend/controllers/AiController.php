<?php
require_once __DIR__ . '/AiController.php';
if (!class_exists('AIController')) {
    class_alias('AiController', 'AIController');
}
