<?php
require_once __DIR__ . '/Schedule.php';
if (!class_exists('Reservation')) {
    class Reservation extends Schedule {}
}
