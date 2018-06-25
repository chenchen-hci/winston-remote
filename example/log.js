var winston = require('winston');
var winstonRemoteTransport = require('winston-remote').Transport;

winston.exitOnError = false;//

var logger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new winstonRemoteTransport({
            host: '127.0.0.1', // Remote server ip
            port: 9003 // Remote server port
        })
    ],
    exitOnError: false,
    silent: false
});

setInterval(() => {
    logger.info('this is a test');
}, 1000);
