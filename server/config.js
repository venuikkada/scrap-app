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
  // Do not print the test OTP on the login page (for a private trial on a public link)
  hideTestOtp: env.HIDE_TEST_OTP === '1',
  // Comma-separated mobile numbers that are made admin at start-up (for hosts without a command line)
  adminMobiles: (env.ADMIN_MOBILES || '').split(',').map((s) => s.trim()).filter((s) => /^[6-9]\d{9}$/.test(s)),
};
