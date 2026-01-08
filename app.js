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
const fs = require('fs'); // Added fs module

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// OSC Configuration
const OSC_IN_IP = "0.0.0.0";
const OSC_IN_PORT = 8000;
const OSC_OUT_IP = "192.168.1.208";
const OSC_OUT_PORT = 9000;

// Load config.json
let POSITION_TO_IMAGE_MAP = {};
let POSITION_MAP = {};
try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    POSITION_TO_IMAGE_MAP = config.position_to_image_map || {};
    POSITION_MAP = config.position_map || {};
    console.log(chalk.green('✅ Loaded configuration from config.json'));
} catch (error) {
    console.error(chalk.red(`❌ Error loading config.json: ${error.message}`));
    console.log(chalk.yellow('⚠️ Using default empty configurations.'));
}




// Video mapping for each button position
const VIDEO_MAPPING = {
    "0": "default.mp4",
    "1": "animation1.mp4",
    "2": "animation2.mp4",
    "3": "animation3.mp4",
    "4": "animation4.mp4",
    "5": "animation5.mp4"
};

let isVideoPlaying = false;


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
    res.render('videoPlayer', { positionMap: POSITION_MAP });
});



// ===================== OSC Setup =====================

// Create OSC UDP Port (handles both sending and receiving)
const oscPort = new osc.UDPPort({
    localAddress: OSC_IN_IP,
    localPort: OSC_IN_PORT,
    remoteAddress: OSC_OUT_IP,
    remotePort: OSC_OUT_PORT
});

// OSC Port ready
oscPort.on("ready", () => {
    console.log(chalk.green(`✅ OSC receiving on ${OSC_IN_IP}:${OSC_IN_PORT}`));
    console.log(chalk.green(`✅ OSC sending to ${OSC_OUT_IP}:${OSC_OUT_PORT}`));
});

// Handle incoming OSC messages from C program
oscPort.on("message", (oscMsg) => {
    console.log(chalk.cyan(`📩 OSC Received: ${oscMsg.address} = ${JSON.stringify(oscMsg.args)}`));

    // Handle movement data: /movement [buttonNumber, positionIndex]
    // The second value is the absolute position index (e.g., 1.5 is halfway between 1 and 2)
    if (oscMsg.address === "/movement") {
        const receivedPositionIndex = oscMsg.args[1];
        // Use the loaded map to transform the positionIndex
        const transformedPosition = POSITION_TO_IMAGE_MAP[String(receivedPositionIndex)];
        const positionToEmit = transformedPosition !== undefined ? transformedPosition : receivedPositionIndex;

        io.emit('movement', { position: positionToEmit });
        console.log(chalk.yellow(`🔄 Movement: Original Position ${receivedPositionIndex}, Emitting Transformed Position ${positionToEmit}`));
    }

    // Handle reached destination: /reached [buttonNumber]
    // Triggered when movement completes - play the video
    if (oscMsg.address === "/reached") {
        const buttonNumber = oscMsg.args[0];
        const videoFile = VIDEO_MAPPING[String(buttonNumber)] || "default.mp4";

        io.emit('reached', { button: buttonNumber });
        console.log(chalk.green(`📍 Reached position ${buttonNumber}`));

        // Play video if not home position (0)
        if (buttonNumber !== 0 && videoFile !== "default.mp4") {
            io.emit('playVideo', { videoFile: videoFile, button: buttonNumber });
            console.log(chalk.blue(`🎬 Playing: ${videoFile}`));
            isVideoPlaying = true;
        }
    }

    // Handle hide command from C program
    if (oscMsg.address === "/hide") {
        io.emit('hideEverythinginVideoScreen');
        console.log(chalk.red("🔴 OSC: Hiding all videos"));
        isVideoPlaying = false;
    }
});

// Handle OSC errors
oscPort.on("error", (err) => {
    console.error(chalk.red(`OSC Error: ${err.message}`));
});

// Function to send OSC message to C program
function sendOSCMessage(address, value) {
    try {
        oscPort.send({
            address: address,
            args: [{ type: "i", value: value }]
        });
        console.log(chalk.magenta(`📤 OSC Sent: ${address} = ${value} to ${OSC_OUT_IP}:${OSC_OUT_PORT}`));
    } catch (err) {
        console.error(chalk.red(`❌ OSC Send Error: ${err.message}`));
    }
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
        // Convert btn7 to 0 (home), otherwise use the number
        const oscValue = buttonNumber === "7" ? 0 : parseInt(buttonNumber);

        // Send button click to C program via OSC
        sendOSCMessage("/start", oscValue);
        console.log(`${oscValue}`);

        // Stop any playing video
        io.emit('stopVideo');
        isVideoPlaying = false;
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
