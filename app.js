const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = socketIo(server); // ✅ Use Socket.IO
const os = require('os');
const chalk = require('chalk');
const osc = require("osc");

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// OSC Configuration
const OSC_RECEIVE_PORT = 8000;    // Port to RECEIVE OSC messages from C program
const OSC_REMOTE_IP = "127.0.0.1"; // IP of C program (localhost if same machine)
const OSC_SEND_PORT = 9000;       // Port to SEND OSC messages to C program
const TRIGGER_RANGES = [
    { min: 30, max: 60, index: 0 },
    { min: 80, max: 120, index: 1 },
    { min: 130, max: 170, index: 2 },
    { min: 180, max: 220, index: 3 },
    { min: 230, max: 270, index: 4 },
    { min: 280, max: 300, index: 5 }
];
let lastDetectedIndex = null;
let triggerStartTime = null;
const TRIGGER_DURATION = 10000; // 10 seconds in milliseconds
let isVideoPlaying = false;


const VIDEO_MAPPING = {
    "0": "default.mp4",
    "1": "animation1.mp4",
    "2": "animation2.mp4",
    "3": "animation3.mp4",
    "4": "animation4.mp4",
    "5": "animation5.mp4"
};


// Set the view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Main Page
app.get('/', (req, res) => {
    res.render('mainscreen');
});

// ✅ Video Player Page
app.get('/videoPlayer', (req, res) => {
    res.render('videoPlayer');
});



// ===================== OSC Setup =====================

// Create OSC UDP Port (handles both sending and receiving)
const oscPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: OSC_RECEIVE_PORT,
    remoteAddress: OSC_REMOTE_IP,
    remotePort: OSC_SEND_PORT
});

// OSC Port ready
oscPort.on("ready", () => {
    console.log(chalk.green(`✅ OSC receiving on port ${OSC_RECEIVE_PORT}`));
    console.log(chalk.green(`✅ OSC sending to ${OSC_REMOTE_IP}:${OSC_SEND_PORT}`));
});

// Handle incoming OSC messages from C program
oscPort.on("message", (oscMsg) => {
    console.log(chalk.cyan(`📩 OSC Received: ${oscMsg.address} = ${oscMsg.args}`));

    // Handle position data from C program
    if (oscMsg.address === "/position") {
        const positionValue = oscMsg.args[0];
        handleOSCPosition(positionValue);
    }

    // Handle trigger commands from C program
    if (oscMsg.address === "/trigger") {
        const triggerIndex = oscMsg.args[0];
        const videoFile = VIDEO_MAPPING[String(triggerIndex)] || "default.mp4";
        io.emit('specialVideoChange', { videoFile });
        console.log(chalk.blue(`📢 OSC Trigger: Playing ${videoFile}`));
    }

    // Handle hide command from C program
    if (oscMsg.address === "/hide") {
        io.emit('hideEverythinginVideoScreen');
        console.log(chalk.red("🔴 OSC: Hiding all videos"));
    }
});

// Handle OSC errors
oscPort.on("error", (err) => {
    console.error(chalk.red(`OSC Error: ${err.message}`));
});

// Function to handle position values received via OSC
function handleOSCPosition(positionValue) {
    console.log(chalk.yellow(`OSC Position Value: ${positionValue}`));

    let selectedVideo = null;
    let detectedIndex = null;

    for (const range of TRIGGER_RANGES) {
        if (positionValue >= range.min && positionValue <= range.max) {
            detectedIndex = range.index;
            selectedVideo = VIDEO_MAPPING[String(range.index)];
            break;
        }
    }

    if (detectedIndex !== null) {
        if (lastDetectedIndex !== detectedIndex) {
            triggerStartTime = Date.now();
            lastDetectedIndex = detectedIndex;
        }
        if (Date.now() - triggerStartTime >= TRIGGER_DURATION) {
            if (isVideoPlaying) {
                io.emit('hideEverythinginVideoScreen');
                isVideoPlaying = false;
            }
            io.emit('specialVideoChange', { videoFile: selectedVideo });
            console.log(chalk.blue(`📢 OSC: Playing ${selectedVideo}`));
            triggerStartTime = null;
            isVideoPlaying = true;
        }
    } else {
        triggerStartTime = null;
        lastDetectedIndex = null;
    }
}

// Function to send OSC message to C program
function sendOSCMessage(address, value) {
    oscPort.send({
        address: address,
        args: [{ type: "i", value: value }]
    });
    console.log(chalk.magenta(`📤 OSC Sent: ${address} = ${value}`));
}

// Open the OSC port
oscPort.open();

// ===================== End OSC Setup =====================

// ✅ Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log('✅ Client connected');

    socket.on('hideEverything', () => {
        console.log('🔴 Hiding everything triggered!');
        io.emit('hideEverythinginVideoScreen');
    });

    socket.on('buttonClick', (data) => {
        console.log('Received from client:', data.message);

        const buttonNumber = data.message.replace(/\D/g, "");

        // Send button click to C program via OSC
        sendOSCMessage("/button", parseInt(buttonNumber));

        io.emit('move', { button: buttonNumber });
        console.log("🟢 Move emitted with button:", buttonNumber);

        isVideoPlaying = false;
    });

    // Relay scroll complete to all clients (to re-enable buttons)
    socket.on('scrollComplete', () => {
        console.log('📍 Scroll complete received');
        io.emit('scrollComplete');
    });

    // Relay video ended to all clients (to re-enable buttons)
    socket.on('videoEnded', () => {
        console.log('🎬 Video ended received');
        isVideoPlaying = false;
        io.emit('videoEnded');
    });

});

// Get server IP address
function getServerIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const addresses = interfaces[interfaceName];
        for (const addressInfo of addresses) {
            if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
                return addressInfo.address;
            }
        }
    }
    return '0.0.0.0';
}



// ✅ Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
