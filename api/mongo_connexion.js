//connexion à mongoose
module.exports = function(){
  mongoUrl = '127.0.0.1:27017/xiaomi-smart-home-gui';
  mongoose = require('mongoose');
  mongoose.Promise = global.Promise;
  mongoose.connect(mongoUrl);

  return mongoose;
};
