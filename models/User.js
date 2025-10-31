const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Add isAdmin to the schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }, // <-- NEW FIELD!
  dateCreated: { type: Date, default: Date.now },
  playCount: { type: Number, default: 0 },
  totalDeaths: { type: Number, default: 0 },
  totalTimePlayed: { type: Number, default: 0 }, // seconds
  credits: { type: Number, default: 1000 }, // changed default from 50 -> 1000 to match server logic
  lastCreditReset: { type: Date, default: null },
});

// Password comparison
userSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Hash password before save
userSchema.pre('save', async function(next) {
  // Prevent clients from elevating privileges in normal register flows:
  if (this.isNew && this.isAdmin !== true) {
    // keep whatever isAdmin was intentionally set to (bootstrap path sets true)
    // This check is just informational; you may also remove isAdmin from any client-controlled payload before creating user.
  }
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

module.exports = mongoose.model('User', userSchema);