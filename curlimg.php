<?php
header("Access-control-Allow-Origin:*");
if(!isset($_GET['t'])) exit();
header("Content-type: image/gif");
$ch = curl_init();
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_URL, $_GET['src']);
$response = curl_exec($ch);
print($response);
