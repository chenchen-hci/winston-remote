var winston = require('winston');
var winstonRemoteTransport = require('../index').Transport;

var logger = winston.createLogger({
    transports: [
        new (winstonRemoteTransport)({
            host: '127.0.0.1', // Remote server ip
            port: 9003 // Remote server port
        })
    ],
    exitOnError: false
});

setInterval(() => {
    logger.info('this is a test');
}, 1000);
