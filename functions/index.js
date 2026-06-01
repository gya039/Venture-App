const { researchDestination } = require('./research');
const { sendTripReminders }  = require('./emailNotifications');

exports.researchDestination = researchDestination;
exports.sendTripReminders   = sendTripReminders;
