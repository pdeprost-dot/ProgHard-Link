FROM debian:12.12-slim@sha256:d5d3f9c23164ea16f31852f95bd5959aad1c5e854332fe00f7b3a20fcc9f635c

ARG ARDUINO_CLI_VERSION=1.5.2-rc.1
ARG ARDUINO_CLI_SHA256=396b4dd7d405ce116b7c95c0941784b005d989c52adfde51d983f66c4b0f9531

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --retry 3 \
      --output /tmp/arduino-cli.tar.gz \
      "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
 && echo "${ARDUINO_CLI_SHA256}  /tmp/arduino-cli.tar.gz" | sha256sum --check --strict \
 && tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli \
 && rm /tmp/arduino-cli.tar.gz \
 && arduino-cli version

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/downloads \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user

RUN arduino-cli config init \
 && arduino-cli config add board_manager.additional_urls \
      https://arduino.esp8266.com/stable/package_esp8266com_index.json \
 && arduino-cli config add board_manager.additional_urls \
      https://espressif.github.io/arduino-esp32/package_esp32_index.json \
 && arduino-cli core update-index \
 && arduino-cli core install esp8266:esp8266@3.1.2 \
 && arduino-cli core install esp32:esp32@3.3.11 \
 && arduino-cli lib install ArduinoJson@7.4.2 \
 && arduino-cli lib install PubSubClient@2.8 \
 && arduino-cli core list \
 && arduino-cli lib list \
 && rm -rf /opt/arduino/downloads/*

COPY build/firmware/build.sh /usr/local/bin/proghard-link-build
RUN sed -i 's/\r$//' /usr/local/bin/proghard-link-build \
 && chmod 0755 /usr/local/bin/proghard-link-build

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/proghard-link-build"]
