const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const GOOGLE_API_KEY = 'XXXXXXXXXXX';
const app = express();
const SECRET_KEY = 'secret123';
const geolib = require('geolib');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MySQL Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'shreyas123',
    database: 'blood_organ_donation',
});

db.connect(err => {
    if (err) throw err;
    console.log('Database connected');
});

// CORS Middleware
app.use(cors({
    origin: ['http://127.0.0.1:5501', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());


// Middleware: Authenticate User
function authenticate(req, res, next) {
    const token = req.headers.authorization;

    if (!token) {
        console.log('Authorization header missing');
        return res.status(401).json({ success: false, message: 'Access denied' });
    }

    const jwtToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

    jwt.verify(jwtToken, SECRET_KEY, (err, user) => {
        if (err) {
            console.log('Token validation error:', err);
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        console.log('Authenticated user:', user);
        req.user_id = user.user_id;
        req.name = user.name;
        next();
    });
}



// Register User
app.post('/api/register', (req, res) => {
    const { name, email, password, location } = req.body;
    if (!name || !email || !password || !location) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const query = 'INSERT INTO Users (name, email, password, location) VALUES (?, ?, ?, ?)';
    db.query(query, [name, email, password, location], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, message: 'Registration successful' });
    });
});

// Login User
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT id, name FROM Users WHERE email = ? AND password = ?';

    db.query(query, [email, password], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (result.length > 0) {
            const user = result[0];
            const token = jwt.sign({ user_id: user.id, name: user.name }, SECRET_KEY, { expiresIn: '1h' });
            res.json({ success: true, token, name: user.name });
        } else {
            res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
    });
});


// Blood Donation

app.post('/api/blood-donation', authenticate, async (req, res) => {
    const { blood_group, location, latitude, longitude, emergencyAvailability, contact, selectedFacilityId } = req.body;
    const user_id = req.user_id; // Extracted from the JWT token

    // Function to fetch blood banks using Google Maps Places API
    async function fetchBloodBanksFromGoogle(latitude, longitude) {
        try {
            const apiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
            const params = {
                location: `${latitude},${longitude}`,
                radius: 20000, // Search within 20 km
                keyword: 'blood bank',
                key: GOOGLE_API_KEY,
            };

            const response = await axios.get(apiUrl, { params });

            console.log('Google Places API response:', response.data); // Add this log for debugging

            if (response.status === 200) {
                return response.data.results;
            } else {
                console.error(`Error: Received status code ${response.status}`);
                return null;
            }
        } catch (error) {
            console.error('Error fetching blood banks from Google:', error.message);
            return null;
        }
    }

    try {
        
        const existingFacilities = await new Promise((resolve, reject) => {
            const queryExistingFacilities = `SELECT id, name, location FROM Facilities1 WHERE facility_type = 'blood_bank' AND location = ?`;
            db.query(queryExistingFacilities, [location], (err, results) => {
                if (err) reject(err);
                else {resolve(results)
                    console.log()
                };
            });
        });

        
        let bloodBanks = existingFacilities;

        if (bloodBanks.length === 0) {
            bloodBanks = await fetchBloodBanksFromGoogle(latitude, longitude);
            console.log(bloodBanks);

            if (!bloodBanks || bloodBanks.length === 0) {
                return res.json({ success: false, message: 'No nearby blood banks found.' });
            }
            //console.log("")
            // Insert fetched blood banks into the Facilities1 table without duplicates
            for (const bank of bloodBanks) {
                const queryInsertFacility = `INSERT INTO Facilities1 (name, location, latitude, longitude, facility_type)
                                             VALUES (?, ?, ?, ?, 'blood_bank')
                                             ON DUPLICATE KEY UPDATE name = VALUES(name), location = VALUES(location)`;  // Insert or update

                await new Promise((resolve, reject) => {
                    db.query(
                        queryInsertFacility,
                        [
                            bank.name,
                            bank.vicinity || bank.formatted_address,
                            bank.geometry.location.lat,
                            bank.geometry.location.lng,
                        ],
                        (err, results) => {  // Get results to retrieve the inserted ID
                            if (err) reject(err);
                            else {
                                //console.log("result",results)
                                // After inserting or updating, get the inserted or existing ID
                                // const facilityId = results.insertId || results[0].id;
                                // bank.id = facilityId;  // Assign the database ID
                                // console.log('Facility inserted/updated with ID:', facilityId);  // Debugging line
                                resolve();
                            }
                        }
                    );
                });
            }

            bloodBanks = await new Promise((resolve, reject) => {
                const querySelectFacilities = `
                    SELECT id, name, location                                 
                    FROM Facilities1 
                    WHERE facility_type = 'blood_bank' 
                    AND ST_Distance_Sphere(
                        POINT(longitude, latitude), 
                        POINT(?, ?)
                    ) <= 10000
                     limit 10
                `;
                
                db.query(querySelectFacilities, [longitude, latitude], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });


        }


        // If a facility is selected for donation
        if (selectedFacilityId) {
            console.log('Selected Facility ID:', selectedFacilityId); // Debugging line
            const selectedFacility = bloodBanks.find((bank) => bank.id === parseInt(selectedFacilityId));


            console.log('Selected Facility:', selectedFacility); // Debugging line

            if (!selectedFacility) {
                return res.status(404).json({ success: false, message: 'Selected facility not found.' });
            }

            // Insert into the donor table if emergency checkbox is checked
            if (emergencyAvailability) {
                const queryInsertDonor = `INSERT INTO Donors1 (user_id, contact, blood_group, emergency_availability) 
                                           VALUES (?, ?, ?, true) 
                                           ON DUPLICATE KEY UPDATE contact = VALUES(contact), blood_group = VALUES(blood_group), emergency_availability = true`;

                await new Promise((resolve, reject) => {
                    db.query(queryInsertDonor, [user_id, contact, blood_group], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }

            // Calculate donation date
            const today = new Date();
            const randomDays = Math.floor(Math.random() * 6) + 5; // Randomly choose a day between 5 and 10 days from now
            const donationDate = new Date(today.setDate(today.getDate() + randomDays)).toISOString().split('T')[0];

            // Insert the donation record into the BloodTransactions table
            const queryInsertDonation = `
    INSERT INTO BloodTransactions1 (user_id, blood_group, transaction_type, transaction_date, blood_bank_id,status)
    VALUES (?, ?, 'donation', ?, ?,'fulfilled')
`;

            await new Promise((resolve, reject) => {
                db.query(queryInsertDonation, [user_id, blood_group, donationDate, selectedFacility.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });

            });

            return res.json({
                success: true,
                message: `Donation scheduled! Go to ${selectedFacility.name} at ${selectedFacility.location} on ${donationDate}.`,
                bloodBank: selectedFacility.name,
                location: selectedFacility.location,
                date: donationDate,
            });
        } else {
            return res.json({
                success: true,
                message: 'Blood bank locations fetched successfully. Please select a blood bank and complete the donation process.',
                facilities: bloodBanks.map((bank) => ({
                    id: bank.id, // Use the database ID
                    name: bank.name,
                    location: bank.location, // Ensure the location field is consistent
                })),
            });

        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again later.' });
    }
});


app.post('/api/get-nearby-blood-banks-donors', async (req, res) => {
    const { location } = req.body;

   
    const bloodBanks = await BloodBank.find({ location: new RegExp(location, 'i') }); 
    const donors = await Donor.find({ location: new RegExp(location, 'i') }); 

   
    const combinedData = {
        bloodBanks: removeDuplicates(bloodBanks),
        donors: removeDuplicates(donors)
    };

    res.json({ success: true, data: combinedData });
});

app.post('/api/blood-request', authenticate, async (req, res) => {
    const { blood_group, location, latitude, longitude } = req.body;
    const user_id = req.user_id; 

    const fetchBloodBanksFromGoogle = async (latitude, longitude) => {
    try {
        // Replace with the actual Google Places API request
        const response = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=10000&keyword=blood%20bank&key=AIzaSyCes8sAmSevzGCkvRu195m5uRutGUHUxeo`);
        const data = await response.json();
        console.log(response,"/n",data);
        if (data.status === "OK") {
            // Parse the response and return the blood bank details
            return data.results.map(result => ({
                name: result.name,
                location: result.vicinity,
                place_id: result.place_id,
                lat: result.geometry.location.lat,
                lng: result.geometry.location.lng,
            }));
        } else {
            console.log(response,data);
            throw new Error('No blood banks found or invalid response');
        }
    } catch (error) {
        console.error('Error fetching blood banks:', error);
        throw error;  // Rethrow the error to be handled later in your code
    }
};


    // Fetch blood banks using Google API
    const bloodBanks = await fetchBloodBanksFromGoogle(latitude, longitude);
    let bloodBanksFromDb = [];

    if (bloodBanks.length === 0) {
        return res.json({ success: false, message: 'No nearby blood banks found.' });
    }

    // Check for existing blood banks in the database
    bloodBanksFromDb = await new Promise((resolve, reject) => {
        const query = `SELECT id, name, location FROM Facilities1 WHERE facility_type = 'blood_bank' AND location = ?`;
        db.query(query, [location], (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });

    // Insert blood banks into the database if not already present
    for (const bank of bloodBanks) {
        if (!bloodBanksFromDb.some(existingBank => existingBank.name === bank.name)) {
            const queryInsert = `INSERT INTO Facilities1 (name, location, latitude, longitude, facility_type)
                                 VALUES (?, ?, ?, ?, 'blood_bank')`;
            await new Promise((resolve, reject) => {
                db.query(queryInsert, [
                    bank.name, 
                    bank.vicinity || bank.formatted_address, 
                    bank.geometry.location.lat, 
                    bank.geometry.location.lng
                ], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }

    // Fetch updated list of blood banks from the database
    bloodBanksFromDb = await new Promise((resolve, reject) => {
        const querySelect = `SELECT id, name, location FROM Facilities1 WHERE facility_type = 'blood_bank' AND location = ?`;
        db.query(querySelect, [location], (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });

    // Fetch donors from the donor1 table
    const donors = await new Promise((resolve, reject) => {
        const querySelectDonors = `SELECT donor_id, name, location FROM donor1 WHERE location = ?`;
        db.query(querySelectDonors, [location], (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });

    return res.json({
        success: true,
        message: 'Blood request details fetched successfully.',
        bloodBanks: bloodBanksFromDb,
        donors: donors
    });
});

app.post('/api/select-option', authenticate, async (req, res) => {
    const { transaction_id, option_type, option_id } = req.body;

    const transactionUpdateQuery = `
        UPDATE BloodTransactions1
        SET status = 'completed', selected_option = ?, selected_option_id = ?
        WHERE transaction_id = ?
    `;

    db.query(transactionUpdateQuery, [option_type, option_id, transaction_id], (err, result) => {
        if (err) {
            return res.json({ success: false, message: 'Failed to update transaction.' });
        }

        return res.json({
            success: true,
            message: `Transaction updated with selected ${option_type}.`
        });
    });
});







app.post('/api/search-organs', authenticate, (req, res) => {
    const { organ_type, location } = req.body;

    const query = `SELECT id, name, location, contact, email, available_resources 
                   FROM Facilities 
                   WHERE facility_type = 'hospital' AND FIND_IN_SET(?, available_resources) > 0 AND location = ?`;
    db.query(query, [organ_type, location], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error while searching for organs.' });

        if (results.length > 0) {
            res.json({ success: true, facilities: results });
        } else {
            res.json({ success: false, message: 'No facilities with the requested organ found in this location.' });
        }
    });
});


// Organ Request
// Google Maps API and other necessary imports
 // For distance calculations

app.post('/api/organ-request', authenticate, async (req, res) => {
    const { organ_type, location } = req.body;
    const user_id = req.user_id;

    try {
        // Step 1: Get latitude and longitude using Google Maps API (Geocoding API)
        const geocodeResponse = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
            params: {
                address: location,
                key: GOOGLE_API_KEY
            }
        });

        const locationData = geocodeResponse.data.results[0].geometry.location;
        const { lat, lng } = locationData;

        // Step 2: Find all hospitals (facility_type='hospital') within Facilities1 table
        const queryHospitals = `SELECT * FROM Facilities1 WHERE facility_type = 'hospital'`;
        db.query(queryHospitals, (err, facilities) => {
            if (err) {
                console.log("error in",err.message)
                return res.status(500).json({ success: false, message: 'error in facilities' });
        }

            // Step 3: Find the nearest hospital
            const nearestHospital = geolib.orderByDistance(
                { latitude: lat, longitude: lng },
                facilities.map(facility => ({
                    ...facility,
                    distance: geolib.getDistance(
                        { latitude: lat, longitude: lng },
                        { latitude: facility.latitude, longitude: facility.longitude }
                    )
                }))
            )[0];

            // Step 4: Insert the organ transaction into OrganTransactions table
            console.log(user_id,organ_type,nearestHospital.id);
            const queryInsertRequest = `INSERT INTO OrganTransactions (user_id, organ_type, hospital_id, transaction_date, status, transaction_type)
                                        VALUES (?, ?, ?, CURDATE(), 'pending', 'request')`;
            db.query(queryInsertRequest, [user_id, organ_type, nearestHospital.id], (err) => {
                if (err) {console.log(err.message);
                    return res.status(500).json({ success: false, message: 'Database error' });
            }

                // Step 5: Return the hospital details to the frontend
                res.json({
                    success: true,
                    message: `Request submitted successfully! Please contact ${nearestHospital.name} at ${nearestHospital.contact} or email ${nearestHospital.email}.`,
                    hospitalName: nearestHospital.name,
                    hospitalContact: nearestHospital.contact,
                    hospitalEmail: nearestHospital.email,
                });
            });
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: 'Error processing request' });
    }
});


// Organ Pledge
app.post('/api/organ-pledge', authenticate, (req, res) => {
    const { organ_type, location, latitude, longitude } = req.body;
    const user_id = req.user_id;

    // Find the nearest hospital based on latitude and longitude
    const queryHospital = `
        SELECT id, name, location, contact, email, latitude, longitude, 
        ( 6371 * acos( cos( radians(?) ) * cos( radians(latitude) ) * cos( radians(longitude) - radians(?) ) + sin( radians(?) ) * sin( radians(latitude) ) ) ) AS distance 
        FROM Facilities1
        WHERE facility_type = 'hospital'
        HAVING distance < 50
        ORDER BY distance
        LIMIT 1
    `;

    db.query(queryHospital, [latitude, longitude, latitude], (err, hospitals) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        if (hospitals.length > 0) {
            const hospital = hospitals[0];

            // Insert the pledge into the OrganTransactions table with status 'pending'
            const queryInsertPledge = `
                INSERT INTO OrganTransactions (user_id, organ_type, hospital_id, transaction_date, status, transaction_type)
                VALUES (?, ?, ?, CURDATE(), 'pending', 'pledge')
            `;
            db.query(queryInsertPledge, [user_id, organ_type, hospital.id], (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Database error' });

                // Return hospital details to the frontend
                res.json({
                    success: true,
                    message: `Your pledge has been submitted successfully! Please send a handwritten pledge with your signature to ${hospital.email}.`,
                    hospitalName: hospital.name,
                    hospitalLocation: hospital.location,
                    hospitalEmail: hospital.email,
                    hospitalContact: hospital.contact,
                });
            });
        } else {
            res.json({ success: false, message: 'No nearby hospitals found to link your pledge.' });
        }
    });
});




// Fetch Organ History (Transactions)
app.get('/api/organ-history', authenticate, (req, res) => {
    const user_id = req.user_id;

    const query = `
        SELECT organ_type, transaction_type, transaction_date, status,
               Facilities1.name AS facility_name, Facilities1.location AS facility_location
        FROM OrganTransactions
        JOIN Facilities1 ON OrganTransactions.hospital_id = Facilities1.id
        WHERE OrganTransactions.user_id = ?
    `;

    db.query(query, [user_id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error while fetching transactions.' });

        if (results.length > 0) {
            res.json({ success: true, transactions: results });
        } else {
            res.json({ success: false, message: 'No transactions found.' });
        }
    });
});


// Update the status of a transaction (Approve or Reject)
app.put('/api/organ-status', authenticate, (req, res) => {
    const { transaction_id, user_id, status } = req.body;

    // Validate status
    if (!['fulfilled', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const queryUpdate = `UPDATE OrganTransactions SET status = ? WHERE id = ? AND user_id = ?`;
    db.query(queryUpdate, [status, transaction_id, user_id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error while updating status.' });

        if (result.affectedRows > 0) {
            res.json({ success: true, message: `Transaction marked as ${status}.` });
        } else {
            res.status(404).json({ success: false, message: 'Transaction not found or unauthorized update.' });
        }
    });
});


// Fetch pending organ requests and pledges for a hospital
app.get('/api/hospital-transactions', authenticate, (req, res) => {
    // Step 1: Query to get the facility_id using the user_id
    const queryFacility = `SELECT id FROM Facilities1 WHERE user_id = ? AND facility_type = 'hospital' LIMIT 1`;

    db.query(queryFacility, [req.user_id], (err, facilityResults) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error while fetching facility.' });
        if (facilityResults.length === 0) return res.status(404).json({ success: false, message: 'Hospital not registered.' });

        const facility_id = facilityResults[0].id;

        // Step 2: Query to fetch the organ transactions for the hospital
        const queryTransactions = `
            SELECT OrganTransactions.id, OrganTransactions.organ_type, OrganTransactions.transaction_type, 
                   OrganTransactions.status, Users.id AS user_id, Users.name AS user_name, 
                   Users.location, Facilities1.name AS facility_name, Facilities1.location AS facility_location
            FROM OrganTransactions
            JOIN Users ON OrganTransactions.user_id = Users.id
            JOIN Facilities1 ON OrganTransactions.hospital_id = Facilities1.id
            WHERE OrganTransactions.hospital_id = ? AND OrganTransactions.status = 'pending'
        `;

        db.query(queryTransactions, [facility_id], (err, results) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error while fetching transactions.' });

            const requests = results.filter(t => t.transaction_type === 'request');
            const pledges = results.filter(t => t.transaction_type === 'pledge');

            res.json({ success: true, requests, pledges });
        });
    });
});



// Hospital Registration Endpoint
app.post('/api/hospital-register', authenticate, (req, res) => {
    const { name, location, contact, email, available_resources } = req.body;
    const user_id = req.user_id;  // From the JWT token

    // First, check if the user already has a hospital
    const checkHospitalQuery = 'SELECT * FROM Facilities1 WHERE user_id = ? AND facility_type = "hospital"';
    db.query(checkHospitalQuery, [user_id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        if (result.length > 0) {
            return res.status(400).json({ success: false, message: 'You already have a hospital registered.' });
        }

        // Proceed with hospital registration if no existing record is found
        const query = 'INSERT INTO Facilities1 (name, location, contact, email, available_resources, user_id, facility_type) VALUES (?, ?, ?, ?, ?, ?, "hospital")';
        db.query(query, [name, location, contact, email, available_resources, user_id], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'Error registering hospital' });

            res.json({ success: true, message: 'Hospital registered successfully' });
        });
    });
});


// Update Hospital Facility
app.put('/api/hospital-update', authenticate, (req, res) => {
    const { facility_id, name, location, contact, email, available_resources } = req.body;
    const user_id = req.user_id;  // Get the user_id of the hospital admin from JWT token

    if (!facility_id || !name || !location || !contact || !email || !available_resources) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const query = `UPDATE Facilities1 
                   SET name = ?, location = ?, contact = ?, email = ?, available_resources = ?
                   WHERE id = ? AND user_id = ?`;

    db.query(query, [name, location, contact, email, available_resources, facility_id, user_id], (err, result) => {
        if (err) {
            console.error('Database Error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Hospital details updated successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Facility not found or unauthorized update' });
        }
    });
});


// Check if the hospital is registered
app.get('/api/check-hospital-registration', authenticate, (req, res) => {
    const user_id = req.user_id;
    console.log('Checking hospital registration for user:', user_id);

    const query = `SELECT * FROM Facilities1 WHERE user_id = ? AND facility_type = 'hospital'`;

    db.query(query, [user_id], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (result.length > 0) {
            console.log('Hospital found for user:', user_id);
            res.json({ success: true, message: 'Hospital is registered.' });
        } else {
            console.log('No hospital registered for user:', user_id);
            res.status(404).json({ success: false, message: 'Hospital not registered.' });
        }
    });
});


// Start Server
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
