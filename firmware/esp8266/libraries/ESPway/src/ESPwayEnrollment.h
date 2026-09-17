#pragma once

#include <Arduino.h>

struct ESPwayEnrollmentRequest {
  String instanceUrl;
  String deviceId;
  String deviceName;
  String hardware;
  String application;
  String applicationVersion;
  String frameworkVersion;
  String credential;
};

struct ESPwayEnrollmentResult {
  bool ok = false;
  int status = 0;
  String claimUrl;
  String baseDomain;
  String error;
};

class ESPwayEnrollment {
 public:
  static ESPwayEnrollmentResult create(const ESPwayEnrollmentRequest& request);
  static bool validInstanceUrl(const String& value);
};
