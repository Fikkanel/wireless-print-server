const os = require('os');

/**
 * Cari IPv4 lokal (non-internal) yang paling mungkin adalah interface WiFi/LAN.
 * Mengembalikan { address, interfaceName } atau null jika tidak ditemukan.
 */
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ interfaceName: name, address: iface.address });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Prioritaskan Wi-Fi / WLAN di atas adapter virtual (seperti VirtualBox Ethernet)
  const wifiCandidate = candidates.find((c) => /wi-?fi|wlan|wireless/i.test(c.interfaceName));
  if (wifiCandidate) return wifiCandidate;

  const ethCandidate = candidates.find((c) => /^ethernet$|^eth0$/i.test(c.interfaceName));
  if (ethCandidate) return ethCandidate;

  const generalEthCandidate = candidates.find((c) => /eth/i.test(c.interfaceName) && !/virtual|vbox|vmnet|vEthernet/i.test(c.interfaceName));
  if (generalEthCandidate) return generalEthCandidate;

  return candidates[0];
}

module.exports = { getLocalIp };
