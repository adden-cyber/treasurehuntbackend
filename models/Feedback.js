// models/Feedback.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FeedbackSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true }, // Store for easy access
  rating: { type: Number, min: 1, max: 5, required: true },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
  adminReply: { type: String, default: '' },
  adminReplyDate: { type: Date }
});

module.exports = mongoose.model('Feedback', FeedbackSchema);