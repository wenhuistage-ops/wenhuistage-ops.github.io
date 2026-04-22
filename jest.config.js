module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  // collectCoverageFrom: [
  //   'js/**/*.js',
  //   '!js/config.js', // 配置文件不需要測試
  // ],
  // 由於項目結構，coverage 閾值暫時禁用
  // 在重構為模塊化後重新啟用
  // coverageThreshold: {
  //   global: {
  //     branches: 50,
  //     functions: 50,
  //     lines: 50,
  //     statements: 50,
  //   },
  // },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/js/$1',
  },
};
