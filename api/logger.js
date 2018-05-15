const dgram = require('dgram');
const serverPort = 9898;
const serverSocket = dgram.createSocket('udp4');
const multicastAddress = '224.0.0.50';
const multicastPort = 4321;
var sidToAddress = {};
var sidToPort = {};

var mongoose = require("./mongo_connexion")();

//Recuperation des modeles
var MEvent = require("./mongo_models/events")(mongoose);
var MDevice = require("./mongo_models/devices")(mongoose);
var MHeartbeat = require("./mongo_models/heartbeats")(mongoose);

//interprete les log en fonctions du type
function printLog(json) {
  var model = json['model'];
  var data = JSON.parse(json['data']);
  if (model === 'sensor_ht' || model == 'weather.v1') {
    var temperature = data['temperature'] ? data['temperature'] / 100.0 : 100;
    var humidity = data['humidity'] ? data['humidity'] / 100.0 : 0;
    console.log("Step 7. Got temperature/humidity sensor:%s's heartbeat: temperature %d, humidity %d", json['sid'], temperature, humidity);
  } else if (model === 'motion' || model == 'sensor_motion.aq2') {
    console.log("Step 7. Got motion sensor:%s's heartbeat: move %s", json['sid'], (data['status'] === 'motion') ? 'detected' : 'not detected');
  } else if (model === 'magnet' || model == 'sensor_magnet.aq2') {
    console.log("Step 7. Got contact/magnet sensor:%s's heartbeat: contact %s", json['sid'], (data['status'] === 'close') ? 'detected' : 'not detected');
  } else if (model === 'ctrl_neutral1') {
    console.log("Step 7. Got light switch:%s's heartbeat: %s", json['sid'], data['channel_0']);
  } else if (model === 'ctrl_neutral2') {
    console.log("Step 7. Got duplex light switch:%s's heartbeat: left %s, right %s", json['sid'], data['channel_0'], data['channel_1']);
  } else if (model == 'switch' || model == 'sensor_switch.aq2' || model == '86sw2') {
    console.log("Step 7. Got switch:%s's heartbeat:%s with voltage:%s", json['sid'], json['data'], data['voltage']);
  } else if (model === 'cube') {
    console.log("Step 7. Got cube:%s's heartbeat:%s with voltage:%s", json['sid'], json['data'], data['voltage']);
  } else if (model === 'gateway') {
    console.log("Step 7. Got gateway:%s's heartbeat:%s with token:%s", json['sid'], json['data'], json['token']);
  } else {
    console.log("Step XXXXXXX. Got %s:%s's heartbeat:%s", json['model'], json['sid'], json['data']);
    console.log('json dump : ' + JSON.stringify(json));
  }
}

function sendWhois() {
  var cmd = '{"cmd": "whois"}';
  serverSocket.send(cmd, 0, cmd.length, multicastPort, multicastAddress);
  console.log('Step 2. Send %s to a multicast address %s:%d.', cmd, multicastAddress, multicastPort);
}

function popInterestingEvent(json){
  //TODO

  //ici il faudra faire les actions !!! verification de scenario etc...
  var evenement = new MEvent({
    sid: json['sid'],
    model: json['model'],
    cmd: json['cmd'],
    data: JSON.parse(json['data'])
  });
  evenement.save(function (err) {
    if (err) {
      console.log('mongodb save Event (result) : ' + err);
    } 
  });
}

function updateHeartbeatState(json,type=""){
  //ici on retire ce qui n'est pas un heartbeat
  if(json['model'] === "switch") {
    //mais si c'est interessant on pop quand meme un evenement
    //ici si on clic un bouton
    if(json['model'] === "switch" && json['data'] !== "{}") {
      popInterestingEvent(json);
    }
    return true;
  }

  //recupere le dernier heartbeat de ce device
  MHeartbeat.findOne({sid: json['sid'], data_type: type, is_last_state: true },function(err, hb) {
      var now = Date.now();//on fixe la microseconde
      if(err) {
        console.error(err);
        return true;
      }
      //si aucune ligne
      var neednew = false;
      //si on a deja une ligne
      if(hb !== null) {
        //on verifie si data sont les memes
        if(JSON.stringify(hb.data) === json['data'] ) {
          //filtre sur les devices qui bougent trop souvent
          let miniDelay = 60*5;
          if(json['model']==="sensor_ht" && (hb.interval_begin_date + miniDelay) < now ){
            return true;
          }
          //si oui on update la date de updatedAt
          hb.save(function (err) {
            if (err) {
              console.log('mongodb save HB (result) : ' + err);
            } 
          });
        } else {
          //on pop un event (le changement d'etat) sauf pour les sensor de temperature
          if(json['model']!=="sensor_ht") {
            popInterestingEvent(json);
          }
          //on ferme l'interval
          hb.interval_end_date = now;
          hb.save(function (err) {
            if (err) {
              console.log('mongodb save HB (result) : ' + err);
            } 
          });
          //puis on crée un nouveau avec les new data
          neednew = true;
        }
      }
      if(hb === null || neednew){
        //on crée un nouvel interval
        var HB = new MHeartbeat({
          sid: json['sid'],
          model: json['model'],
          data_type: type,
          is_last_state: true,
          data: JSON.parse(json['data']) ,
          interval_begin_date: now
        });
        HB.save(function (err) {
          if (err) {
            console.log('mongodb save HB (result) : ' + err);
          } 
        });
      }
  });
}

//exemple de message recu:
//{"cmd":"heartbeat","model":"gateway","sid":"f0b4299a63d9","short_id":"0","token":"1hX9gW20eIkqZRlY","data":"{\"ip\":\"192.168.0.12\"}"}
serverSocket.on('message', function(msg, rinfo){
  console.log('recv %s(%d bytes) from client %s:%d\n', msg, msg.length, rinfo.address, rinfo.port);
  var json;
  try {
      json = JSON.parse(msg);
  } catch (e) {
    console.log('Unexpected message: %s', msg);
    return;
  }

  var cmd = json['cmd'];
  //reception de la reponse a "whois", chaque hub renvoi cela
  if (cmd === 'iam') {
    var address = json['ip'];
    var port = json['port'];
    //on lui demande la liste de ses devices
    var iam = '{"cmd":"get_id_list"}';
    //et on enregistre la gateway
    MDevice.find({sid: json['sid']},function(error,gtw){
      if(error){
        console.error('MDevice gateway error : ' + error);
        return;
      }
      if(gtw === null){
        var dev = new MDevice({
          sid: json['sid'],
          name: "Unknown Gateway",
          model: "gateway"
        });
        dev.save(function (err) {
            if (err) {
              console.log('mongodb save Device (result) : ' + err);
            } 
          });
      }
    });


    console.log('Step 3. Send %s to %s:%d', cmd, address, port);
    console.log('iam : ' + iam.toString('hex'));
    serverSocket.send(iam, 0, iam.length, port, address);
  }else if (cmd === 'get_id_list_ack') { //reception de la liste des devices d'un hub
    console.log ('get_id_list_ack dump : ' + JSON.stringify(json));
    var data = JSON.parse(json['data']);
    data.forEach(function(dsid) {
      //on insere les nouveaux devices
      MDevice.findOne({sid: dsid },function(error,dev) {
        if(error){
          console.error(error);
        }
        if(dev === null){
          console.log('create device (' + dsid +')');
          dev = new MDevice({
            sid: dsid,
            name: "Unknown Device"
          });
          dev.save(function (err) {
            if (err) {
              console.log('mongodb save Device (result) : ' + err);
            }
            //on demande a chaque device son etat
            var response = '{"cmd":"read", "sid":"' + dsid + '"}';
            // on stocke l'ip/port de la gateway sur laquel on peut contacter ce device
            sidToAddress[dsid] = rinfo.address;
            sidToPort[dsid] = rinfo.port;
            console.log('Step 4. Send %s to %s:%d', response, rinfo.address, rinfo.port);
            serverSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
          });
        }
      });

    });
  } else if (cmd === 'read_ack' || cmd === 'report' || cmd === 'heartbeat') { //on recois l'etat d'une device par demande du logger, un push, ou un ping
    if (cmd === 'read_ack') {
      //on update ici le model des devices car on a demandé un etat des lieux
      console.log('read ack... updating model for '+json['sid']+" -> "+json['model']);
      MDevice.findOne({sid: json['sid']}, function (err, dev) {
        if (err) console.log('MDevice.findOne error : ' + err);
        if(dev){
          dev.model = json['model'];
          dev.save(function (err) {
            if (err) {
              console.log('mongodb save Device (result) : ' + err);
            } 
          });
        } else {
          console.log('read ack... updating model for '+json['sid']+" -> "+json['model'] + ' FAILED ########################################');
        }
      });
    }

    //pour les capteurs multiple on enregistre separement les etats
    if(json['model']==="sensor_ht"){
      let copy = JSON.parse(JSON.stringify(json));//deep clone
      let datadec = JSON.parse(json['data']);
      if(typeof datadec['temperature'] !== "undefined"){
        copy['data'] = JSON.stringify(datadec['temperature']);
        updateHeartbeatState(copy,'temperature');
      }
      if(typeof datadec['humidity'] !== "undefined"){
        copy['data'] = JSON.stringify(datadec['humidity']);
        updateHeartbeatState(copy,'humidity');
      }
    } else { //sinon on enregistre tout
      updateHeartbeatState(json,'');//necessaire pour le motion (entre autre), mais a eviter pour le button
    }
    printLog(json);
  } else if (cmd === 'write') { //ici on se sert du logger pour passer des command a la gateway correspondant au bon sid
    // Commands from udpclient.js, pass them to gateway
    var sid = json['sid'];
    if (!sid || !sidToPort[sid] || !sidToAddress[sid]) {
      console.log('Invalid or unknown sid in %s', msg);
    } else {
      serverSocket.send(msg, 0, msg.length, sidToPort[sid], sidToAddress[sid]);
    }
  } else {
    console.log('recv %s(%d bytes) from client %s:%d\n', msg, msg.length, rinfo.address, rinfo.port);
    //on l'insere quand meme dans la base des event log...
    popInterestingEvent(json);
  }
});

//    err - Error object, https://nodejs.org/api/errors.html
serverSocket.on('error', function(err){
  console.log('error, msg - %s, stack - %s\n', err.message, err.stack);
});

serverSocket.on('listening', function(){
  console.log('Step 1. Start a UDP server, listening on port %d.', serverPort);
  serverSocket.addMembership(multicastAddress);
});

console.log('Demo server, in the following steps:');

serverSocket.bind(serverPort);



//on demande quel hub sont connecté
sendWhois();

//on relance un whois toute les 30sec (necessaire pour la detection de fin d'un mouvement)
setInterval(function() {
  console.log('Step 2. Start another round.');
  sendWhois();
}, 30000);
