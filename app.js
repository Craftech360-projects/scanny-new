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
const ModbusRTU = require("modbus-serial");

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const MODBUS_SERVER_IP = "192.168.1.5"; // Replace with your Modbus server IP
const MODBUS_SERVER_PORT = 502;          // Default Modbus TCP port
const MODBUS_REGISTER_ADDRESS_1 = 40024;   // First Modbus register address to write to
const MODBUS_REGISTER_ADDRESS_2 = 40025;   // Second Modbus register address to write to
const MODBUS_REGISTER_ADDRESS_3 = 40026;   // Second Modbus register address to write to
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
const TRIGGER_DURATION = 60000; // 1 minute in milliseconds
let isVideoPlaying = false;
let modbusClient;
let isModbusConnected = false;


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

let lastClickedItem = ''; // ✅ Store last clicked item

const videoMappings = {
    "1": {
        'EHVCA': 'VA1.mp4',
        'HVCA': 'VA2.mp4',
        'MVCA': 'VA3.mp4',
        'PCA': 'VA4.mp4',
        'TLA': 'VA5.mp4',
        'JB': 'VA6.mp4',
        'ELPS': 'VA7.mp4',
        'Oil Type': 'VA8.mp4',
        'AMPACT': 'VA9.mp4'
    },
    "2": {
        'MVCA': 'VB1.mp4',
        'LVCA': 'VB2.mp4',
        'OCP2': 'VB3.mp4',
        'Indoor': 'VB12.mp4',
        'DOV': 'VB4.mp4',
        'Cable': 'VB6.mp4',
        'Acc': 'VB7.mp4',
        'AMPACT': 'VB8.mp4',
        'LVABC': 'VB9.mp4',
        'Gloves': 'VB10.mp4',
        'Mat': 'VB11.mp4'
    },
    "3": {
        'Connector': 'VC1.mp4',
        'JB': 'VC2.mp4',
        'Solar Trafo': 'VC3.mp4',
        'MVCA': 'VC4.mp4',
        'PCA': 'VC5.mp4',
        'OCP': 'VC6.mp4'
    },
    "4": {
        'Busbar': 'VD1.mp4',
        'Gloves': 'VD2.mp4',
        'Mat': 'VD3.mp4',
        'Arcsuit': 'VD4.mp4',
        'Industrial protection': 'VD5.mp4',
        'Oil and Gas protection': 'VD6.mp4',
        'Oil Type': 'VD7.mp4',
        'JB': 'VD8.mp4',
        'SS Enclosure': 'VD9.mp4',
        'Customisation': 'VD10.mp4',
        'Diff': 'VD11.mp4'
    },
    "5": {
        'g1.6': 'VE1.mp4',
        'Postpaid': 'VE2.mp4',
        'prepaid': 'VE3.mp4',
        'Building Not Doing': 'VE4.mp4',
        'Energy Power Division-service (EPD-Service)': 'VE5.mp4',
        'Gloves': 'VE6.mp4',
        'AB Acc': 'VE7.mp4',
        'MCS': 'VE8.mp4',
        'ATD': 'VE9.mp4',
        'Dropper': 'VE10.mp4',
        'Insulator': 'VE11.mp4',
        'Lugs': 'VE12.mp4',
        'ties': 'VE13.mp4',
        'Glands': 'VE14.mp4'
    }
};


// ✅ Function to get video file based on screen and clicked item
function getVideoFile(screenId, videoName) {
    videoName = videoName.trim().replace(/\s+›$/, ''); // ✅ Trim whitespace and remove special symbols
    console.log(`📌 Fetching video for Screen ${screenId}, Cleaned Item: "${videoName}"`);

    return videoMappings[screenId]?.[videoName] || 'default.mp4';
}

// ✅ Main Page
app.get('/', (req, res) => {
    res.render('mainscreen');
});

// ✅ Screens 1-5
app.get('/screen:id', (req, res) => {
    res.render(`screen${req.params.id}`);
});

// ✅ Single Video Player Page (No ID Change)
app.get('/videoPlayer', (req, res) => {
    res.render('videoPlayer', { videoName: lastClickedItem, videoFile: 'default.mp4' });
});

// ✅ Handle button click tracking for different screens
app.post('/track:id', (req, res) => {
    const screenId = req.params.id;
    let { item } = req.body;

    item = item.trim().replace(/\s+›$/, ''); // ✅ Ensure cleaned item
    console.log(`📩 POST /track${screenId} - Cleaned Item: "${item}"`);

    if (item) {
        lastClickedItem = item;
        const videoFile = getVideoFile(screenId, item);

        console.log(`📢 Emitting 'videoChange' with video: ${videoFile} for screen ${screenId}`);
        //emit after the tv reaches to that respective position 
        // ✅ Emit event to update `videoPlayer.ejs`
        io.emit(`videoChange`, { videoFile, videoName: item });

        res.status(200).json({ message: `Signal received for: ${item} on screen ${screenId}` });
    } else {
        console.log(`❌ Error: No item received on screen ${screenId}.`);
        res.status(400).json({ error: 'No item provided' });
    }
});



// Initialize Modbus TCP client (async version)
async function initializeModbusClient() {
    try {
        modbusClient = new ModbusRTU();
        await modbusClient.connectTCP(MODBUS_SERVER_IP, { port: MODBUS_SERVER_PORT });
        console.log(chalk.green(`Connected to Modbus TCP server at ${MODBUS_SERVER_IP}:${MODBUS_SERVER_PORT}`));
        isModbusConnected = true;
        // startModbusReading();

        modbusClient.on('error', async (err) => {
            console.error(chalk.red(`Modbus connection error: ${err.message}`));
            isModbusConnected = false;
            console.log(chalk.yellow("Attempting to reconnect to Modbus server..."));
            await initializeModbusClient();
        });
    } catch (err) {
        console.error(chalk.red(`Failed to connect to Modbus TCP server: ${err.message}`));
        console.log(chalk.yellow("Retrying connection in 5 seconds..."));
        await new Promise(resolve => setTimeout(resolve, 5000));
        await initializeModbusClient();
    }
}

// Function to write data to a Modbus register
async function writeToModbusRegister(registerAddress, value) {
    if (!modbusClient || !modbusClient.isOpen) {
        console.error(chalk.red("Modbus client is not initialized or connection is not open. Skipping write operation."));
        return;
    }
    try {
        await modbusClient.writeRegister(registerAddress - 40001, value);
        console.log(chalk.green(`Successfully wrote value ${value} to Modbus register ${registerAddress}`));
    } catch (err) {
        console.error(chalk.red(`Error writing to Modbus register ${registerAddress}: ${err.message}`));
        await initializeModbusClient();
    }
}

// Function to continuously read from Modbus
async function startModbusReading() {
    while (true) {
        if (isModbusConnected) {
            try {
                const data = await modbusClient.readHoldingRegisters(MODBUS_REGISTER_ADDRESS_3 - 40001, 1);
                const modbusValue = data.data[0];
                console.log(chalk.yellow(`Modbus Read Value: ${modbusValue}`));

                let selectedVideo = null;
                let detectedIndex = null;
                for (const range of TRIGGER_RANGES) {
                    if (modbusValue >= range.min && modbusValue <= range.max) {
                        detectedIndex = range.index;
                        selectedVideo = VIDEO_MAPPING[String(range.index)]; // Ensure index is used as a string key
                        break;
                    }
                }

                if (detectedIndex !== null) {
                    if (lastDetectedIndex !== detectedIndex) {
                        // Reset timer if new index detected
                        triggerStartTime = Date.now();
                        lastDetectedIndex = detectedIndex;
                    }
                    if (Date.now() - triggerStartTime >= TRIGGER_DURATION) {
                        if (isVideoPlaying) {
                            io.emit('hideEverythinginVideoScreen');
                            console.log(chalk.red("🔴 Hiding all videos, showing background image with scrolling."));
                            isVideoPlaying = false;
                        }
                        io.emit('specialVideoChange', { videoFile: selectedVideo });
                        console.log(chalk.blue(`📢 Emitting 'specialVideoChange' for value: ${modbusValue} -> ${selectedVideo}`));
                        // Reset timer after emitting
                        triggerStartTime = null;
                        isVideoPlaying = true;
                    }
                } else {
                    // Reset if value goes out of range
                    triggerStartTime = null;
                    lastDetectedIndex = null;
                }
            } catch (err) {
                console.error(chalk.red(`Error reading Modbus register: ${err.message}`));
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Read every second
    }
}

async function handleSequentialWrites(value) {
    if (!isModbusConnected) {
        console.error(chalk.red("Modbus client is not connected. Cannot process sequential writes."));
        return;
    }
    // Step 1: Write the received value to register 40024
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_1, value);

    // Step 2: After 1 second, write 1 to register 40025
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_2, 1);

    // Step 3: After another 1 second, write 0 to register 40025
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_2, 0);
}

// Function to continuously read from Modbus
async function startModbusReadingTest() {
    while (true) {
        try {
            const modbusValue = Math.floor(Math.random() * 301); // Generate random value between 0-300
            console.log(chalk.yellow(`Generated Dummy Modbus Value: ${modbusValue}`));

            let selectedVideo = null;
            let detectedIndex = null;
            for (const range of TRIGGER_RANGES) {
                if (modbusValue >= range.min && modbusValue <= range.max) {
                    detectedIndex = range.index;
                    selectedVideo = VIDEO_MAPPING[String(range.index)]; // Ensure index is used as a string key
                    break;
                }
            }

            if (detectedIndex !== null) {
                if (lastDetectedIndex !== detectedIndex) {
                    // Reset timer if new index detected
                    triggerStartTime = Date.now();
                    lastDetectedIndex = detectedIndex;
                }
                if (Date.now() - triggerStartTime >= TRIGGER_DURATION) {
                    if (isVideoPlaying) {
                        io.emit('hideEverythinginVideoScreen');
                        console.log(chalk.red("🔴 Hiding all videos, showing background image with scrolling."));
                        isVideoPlaying = false;
                    }
                    io.emit('specialVideoChange', { videoFile: selectedVideo });
                    console.log(chalk.blue(`📢 Emitting 'specialVideoChange' for value: ${modbusValue} -> ${selectedVideo}`));
                    // Reset timer after emitting
                    triggerStartTime = null;
                    isVideoPlaying = true;
                }
            } else {
                // Reset if value goes out of range
                triggerStartTime = null;
                lastDetectedIndex = null;
            }
        } catch (err) {
            console.error(chalk.red(`Error in dummy Modbus reading: ${err.message}`));
        }
        await new Promise(resolve => setTimeout(resolve, 1000000)); // Read every second
    }
}

// ✅ Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log('✅ Client connected');

    socket.on('hideEverything', () => {
        console.log('🔴 Hiding everything triggered!');
        // ✅ Broadcast to all clients if needed
        io.emit('hideEverythinginVideoScreen');
    });


    socket.on('buttonClick', async (data) => {
        console.log('Received from client:', data.message);

        const buttonNumber = data.message.replace(/\D/g, "");


        //initialising 
        await initializeModbusClient();
        //writting
        await handleSequentialWrites( parseInt(buttonNumber));
        io.emit('move', { button: buttonNumber });
        console.log("🟢 Move emitted with button:", buttonNumber);
        if (isVideoPlaying) {
            io.emit('hideEverythinginVideoScreen');
            console.log("🔴 Video was playing, hiding all videos and showing background.");
            isVideoPlaying = false;
        }

        console.log("data ")
    });

});

// initializeModbusClient();


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
    // const ipAddress = getServerIPAddress();
    // startModbusReadingTest();
    startModbusReading();

    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
