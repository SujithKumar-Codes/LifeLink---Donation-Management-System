const axios = require('axios');

// Function to fetch blood banks using Google Maps Places API
async function fetchBloodBanks(location, apiKey) {
    try {
        // Google Maps Places API endpoint
        const apiUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json`;
        
        // Parameters for the API request
        const params = {
            query: 'blood bank',
            location: location, // Format: "latitude,longitude"
            radius: 5000, // Search within 5 km
            key: apiKey
        };

        // Make the API request
        const response = await axios.get(apiUrl, { params });

        if (response.status === 200) {
            const bloodBanks = response.data.results;
            console.log('Blood Banks:', bloodBanks);
            return bloodBanks;
        } else {
            console.error(`Error: Received status code ${response.status}`);
            return null;
        }
    } catch (error) {
        console.error('Error fetching blood banks:', error.message);
        return null;
    }
}

// Usage example
const apiKey = 'YOUR_API_KEY'; // Replace with your API key
const location = '12.852100,74.911903'; // Replace with latitude,longitude (Bangalore in this case)

fetchBloodBanks(location, apiKey).then(bloodBanks => {
    if (bloodBanks) {
        bloodBanks.forEach((bank, index) => {
            console.log(`${index + 1}. ${bank.name} - ${bank.formatted_address}`);
        });
    } else {
        console.log('No blood banks found or an error occurred.');
    }
});
