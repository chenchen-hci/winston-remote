var winstonRemote = require('../index').Server;
var winston = require('winston');

var winstonServer = winstonRemote.createServer({
    port: 9003
});

winstonServer.listen();
