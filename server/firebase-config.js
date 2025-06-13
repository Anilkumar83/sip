const admin = require('firebase-admin');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://freshvault-b46ce-default-rtdb.firebaseio.com"
});

const database = admin.database();

module.exports = { database };