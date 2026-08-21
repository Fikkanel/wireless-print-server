const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * Menyimpan antrian & riwayat print job di memori (FIFO, sederhana — sesuai
 * scope v1 di PRD: "Tidak ada sistem antrian multi-user kompleks").
 * Emit event 'update' setiap kali ada perubahan supaya bisa di-broadcast via WebSocket.
 */
class JobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.maxHistory = 100;
  }

  createJob({ fileName, deviceName, options }) {
    const job = {
      id: crypto.randomUUID(),
      fileName,
      deviceName: deviceName || 'HP Tanpa Nama',
      options,
      status: 'uploading', // uploading -> processing -> printing -> done | error
      message: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.unshift(job);
    if (this.jobs.length > this.maxHistory) this.jobs.pop();
    this.emit('update', job);
    return job;
  }

  updateJob(id, patch) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.emit('update', job);
    return job;
  }

  getJob(id) {
    return this.jobs.find((j) => j.id === id) || null;
  }

  getAll() {
    return this.jobs;
  }
}

module.exports = new JobStore();
