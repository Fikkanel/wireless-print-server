const impl = process.platform === 'win32' ? require('./printerWin') : require('./printerUnix');

module.exports = impl;
