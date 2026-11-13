const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  appName: env.APP_NAME || 'Scrap Pickup',
  city: env.APP_CITY || 'Hyderabad',
  dbPath: env.DB_PATH || 'data/app.db',
  otpMode: env.OTP_MODE === 'sms' ? 'sms' : 'test',
  testOtp: env.TEST_OTP || '123456',
  cookieSecure: env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  production: env.NODE_ENV === 'production',
  allowTestOtpInProduction: env.ALLOW_TEST_OTP === '1',
};
