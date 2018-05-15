var serve = require('koa-static');
var koa = require('koa');
var router = require('koa-router')();
var app = koa();

//Livraison static de la gui par koa-static
app.use(serve(__dirname+'/gui'));

//connexion à mongoose
var mongoose = require("./mongo_connexion")();
koaRestMongoose = require('koa-rest-mongoose');

//ajout de chaque model a l'api
var fs = require('fs');
fs.readdirSync(__dirname+"/mongo_models")
  .filter(function(file) {
    return (file.indexOf('.') !== 0) && (file.slice(-3) === '.js');
  })
  .forEach(function(file) {
    var name = file.split('.js')[0];
    var model = require('./mongo_models/'+name)(mongoose);
    koaRestMongoose(app,router,model,"/api");
  });

app.listen(3101);

console.log('listening on port 3101');
