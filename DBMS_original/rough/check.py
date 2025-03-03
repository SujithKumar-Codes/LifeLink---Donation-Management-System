import requests

def check_google_api_key(api_key):
    # URL for the Google Maps Geocoding API
    url = "https://maps.googleapis.com/maps/api/geocode/json"

    # Parameters for the request
    params = {
        "address": "Mangalore",
        "key": api_key
    }

    # Make the GET request
    response = requests.get(url, params=params)

    # Check the response status
    if response.status_code == 200:
        data = response.json()
        if data.get("status") == "OK":
            print("API Key is working. Here are the coordinates of New York:")
            print(data["results"][0]["geometry"]["location"])
        elif data.get("status") == "REQUEST_DENIED":
            print("Request denied. Check your API key and billing settings.")
            print("Error message:", data.get("error_message"))
        else:
            print("API Key is not working. Response status:", data.get("status"))
    else:
        print("HTTP Error. Status code:", response.status_code)

# Replace 'YOUR_API_KEY' with your actual API key
api_key = "YOUR_API_KEY"
check_google_api_key(api_key)
