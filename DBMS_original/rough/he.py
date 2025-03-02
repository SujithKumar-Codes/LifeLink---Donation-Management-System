import requests

# Define the API URL and parameters
location = '12.9141417,74.8559568'  # Example latitude and longitude
radius = 10000  # 10 km radius
keyword = 'blood bank'
api_key = 'AIzaSyCes8sAmSevzGCkvRu195m5uRutGUHUxeo'  # Replace with your actual API key

url = f'https://maps.googleapis.com/maps/api/place/nearbysearch/json'

params = {
    'location': location,
    'radius': radius,
    'keyword': keyword,
    'key': api_key
}

# Make the GET request to the API
response = requests.get(url, params=params)

# Check if the request was successful
if response.status_code == 200:
    data = response.json()
    
    # Check if results were returned
    if data['status'] == 'ZERO_RESULTS':
        print('No blood banks found.')
    else:
        print('Results:', data['results'])
else:
    print(f"Error: {response.status_code}, {response.text}")
