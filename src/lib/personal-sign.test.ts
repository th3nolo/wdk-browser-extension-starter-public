import { describe, expect, it } from "vitest";
import {
  decodePersonalSignMessage,
  parsePersonalSignParams,
  PERSONAL_SIGN_MAX_MESSAGE_BYTES
} from "./personal-sign";

describe("personal_sign parsing", () => {
  const connected = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

  it("decodes hex-encoded UTF-8 messages for display while keeping canonical hex for signing", () => {
    expect(decodePersonalSignMessage("0x48656c6c6f")).toEqual({
      message: "0x48656c6c6f",
      displayMessage: "Hello",
      messageEncoding: "hex",
      messageByteLength: 5
    });
  });

  it("accepts binary hex payloads and shows hex when not UTF-8 decodable", () => {
    expect(decodePersonalSignMessage("0xdeadbeef")).toEqual({
      message: "0xdeadbeef",
      displayMessage: "0xdeadbeef",
      messageEncoding: "hex",
      messageByteLength: 4
    });
  });

  it("accepts plain-text messages", () => {
    expect(decodePersonalSignMessage("Sign in to WDK demo")).toEqual({
      message: "Sign in to WDK demo",
      displayMessage: "Sign in to WDK demo",
      messageEncoding: "utf8",
      messageByteLength: 19
    });
  });

  it("rejects empty and invalid messages", () => {
    expect(() => decodePersonalSignMessage("")).toThrow("cannot be empty");
    expect(() => decodePersonalSignMessage("0x")).toThrow("cannot be empty");
    expect(() => decodePersonalSignMessage("0x0g")).toThrow("Invalid hex-encoded");
  });

  it("enforces the message size cap", () => {
    const oversized = "a".repeat(PERSONAL_SIGN_MAX_MESSAGE_BYTES + 1);
    expect(() => decodePersonalSignMessage(oversized)).toThrow("too large");
    const hexOversized = `0x${"61".repeat(PERSONAL_SIGN_MAX_MESSAGE_BYTES + 1)}`;
    expect(() => decodePersonalSignMessage(hexOversized)).toThrow("too large");
  });

  it("parses standard [message, address] params", () => {
    expect(parsePersonalSignParams(["Hello", connected], connected)).toEqual({
      message: "Hello",
      displayMessage: "Hello",
      messageEncoding: "utf8",
      messageByteLength: 5
    });
  });

  it("parses reversed [address, message] params", () => {
    expect(parsePersonalSignParams([connected, "0x48656c6c6f"], connected)).toEqual({
      message: "0x48656c6c6f",
      displayMessage: "Hello",
      messageEncoding: "hex",
      messageByteLength: 5
    });
  });

  it("rejects mismatched addresses and malformed params", () => {
    expect(() => parsePersonalSignParams(["Hello"], connected)).toThrow("Invalid personal_sign params");
    expect(() => parsePersonalSignParams([connected, connected], connected)).toThrow("Invalid personal_sign params");
    expect(() => parsePersonalSignParams(["Hello", "0x0000000000000000000000000000000000000001"], connected))
      .toThrow("does not match connected account");
  });
});
