// server10.js: force Douyin sorted outer-field signature test
// This keeps the stable server7 runtime and only changes the signing mode.
process.env.DOUYIN_SIGN_MODE = 'sorted';
require('./server7.js');
