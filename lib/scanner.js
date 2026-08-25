const impl = process.platform === 'win32' ? require('./scannerWin') : require('./scannerUnix');

module.exports = impl;
