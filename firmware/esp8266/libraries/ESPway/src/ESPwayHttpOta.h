#pragma once

#include <Arduino.h>

struct ESPwayHttpOtaCommand {
  String url;
  String sha256;
  String firmwareVersion;
  size_t size = 0;
};

class ESPwayHttpOta {
 public:
  static constexpr size_t URL_MAX_LENGTH = 240;
  static constexpr size_t VERSION_MAX_LENGTH = 32;

  static bool parseCommand(
    const String& body,
    ESPwayHttpOtaCommand& command,
    String& error
  );
  static bool download(const ESPwayHttpOtaCommand& command, String& error);
};
