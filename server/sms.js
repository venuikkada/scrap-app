// SMS sending for real OTPs (used only when OTP_MODE=sms).
//
// No SMS provider is wired up yet. To go live, pick an Indian SMS provider
// (for example MSG91, Fast2SMS or Twilio), register a DLT template for the OTP
// message, and replace the body of this function with their HTTP API call.
// Read the API key from an environment variable - never hard-code it.
export async function sendOtpSms(mobile, code) {
  void mobile;
  void code;
  throw new Error('sms_not_configured');
}
