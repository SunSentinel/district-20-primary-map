// Initialize the map with default zoom controls disabled
const map = L.map('map', {
    zoomControl: false
}).setView([26.15, -80.25], 11);

// Re-add Zoom Controls to the TOP RIGHT so they don't clash with the legend on the left
L.control.zoom({
    position: 'topright'
}).addTo(map);

// Add a clean, light basemap
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO'
}).addTo(map);

// Add Address Search Bar (Placed on Top Right)
L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "Search an address..."
}).on('markgeocode', function(e) {
    const bbox = e.geocode.bbox;
    const poly = L.polygon([
        bbox.getSouthEast(),
        bbox.getNorthEast(),
        bbox.getNorthWest(),
        bbox.getSouthWest()
    ]);
    map.fitBounds(poly.getBounds());
    
    L.marker(e.geocode.center).addTo(map)
        .bindPopup(e.geocode.name)
        .openPopup();
}).addTo(map);

let geojsonData;
let electionData = {};
let geojsonLayer;
const mainCandidate = "Debbie Wasserman Schultz";

// Fetch GeoJSON and CSV data concurrently
Promise.all([
    fetch('Broward_VoterPrecincts_2024.geojson').then(res => {
        if (!res.ok) throw new Error(`Could not find geojson (HTTP ${res.status})`);
        return res.json();
    }),
    fetch('District_20_Precincts.csv').then(res => {
        if (!res.ok) throw new Error(`Could not find csv (HTTP ${res.status})`);
        return res.text();
    })
]).then(([geojson, csvText]) => {
    geojsonData = geojson;
    
    Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            results.data.forEach(row => {
                if(row.Precinct) {
                    electionData[row.Precinct] = row;
                }
            });
            initMap();
        }
    });
}).catch(err => {
    console.error("Data loading error:", err);
    alert(err.message + "\n\nPlease ensure your file names match in VS Code.");
});

function initMap() {
    const firstRow = Object.values(electionData)[0];
    
    if (!firstRow) {
        console.error("No valid precinct data found.");
        return;
    }
    
    const allCandidates = Object.keys(firstRow).filter(col => col !== 'Precinct');
    const opponents = allCandidates.filter(col => col !== mainCandidate);
    
    const select = document.getElementById('opponent-select');
    select.innerHTML = ""; 
    
    // Default option: Overall Precinct Winner
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.text = "Overall Precinct Winner";
    defaultOption.selected = true;
    select.appendChild(defaultOption);
    
    opponents.forEach(opp => {
        const option = document.createElement('option');
        option.value = opp;
        option.text = "Compare to: " + opp;
        select.appendChild(option);
    });

    select.addEventListener('change', updateMap);
    
    updateMap();
}

function updateMap() {
    const opponentSelect = document.getElementById('opponent-select');
    const opponent = opponentSelect.value;
    
    // Extract last name of opponent
    let oppLastName = "Opponent";
    if (opponent) {
        const nameParts = opponent.trim().split(" ");
        oppLastName = nameParts[nameParts.length - 1];
    }

    // Dynamically update legend text with last names and 'No data'
    const oppLegendLabel = opponent ? `${oppLastName} leads` : "Opponent leads";
    
    document.querySelector('.legend').innerHTML = `
        <div><span style="background:#08519c"></span> DWS leads</div>
        <div><span style="background:#cc4c02"></span> ${oppLegendLabel}</div>
        <div><span style="background:#f0f0f0"></span> No data</div>
    `;

    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    geojsonLayer = L.geoJson(geojsonData, {
        style: function(feature) {
            const pctId = feature.properties.NAME; 
            const data = electionData[pctId];
            
            if (!data) return { color: 'white', fillColor: '#ccc', weight: 1, fillOpacity: 0.8 }; 

            let totalVotes = 0;
            const candidates = Object.keys(data).filter(key => key !== 'Precinct' && typeof data[key] === 'number');
            candidates.forEach(key => totalVotes += data[key]);

            if (totalVotes === 0) {
                return { color: 'white', fillColor: '#f0f0f0', weight: 1, fillOpacity: 0.8 };
            }

            let winStatus = "Tie";

            if (!opponent) {
                // Default View: Find overall max vote getter
                let maxVotes = -1;
                let winner = "";
                
                candidates.forEach(cand => {
                    if (data[cand] > maxVotes) {
                        maxVotes = data[cand];
                        winner = cand;
                    } else if (data[cand] === maxVotes) {
                        winner = "Tie";
                    }
                });

                if (winner === mainCandidate) {
                    winStatus = "DWS";
                } else if (winner !== "Tie" && winner !== "") {
                    winStatus = "Opponent";
                }
            } else {
                // Head-to-head comparison
                const mainVotes = data[mainCandidate] || 0;
                const oppVotes = data[opponent] || 0;

                if (mainVotes > oppVotes) winStatus = "DWS";
                else if (oppVotes > mainVotes) winStatus = "Opponent";
            }

            return {
                fillColor: getColor(winStatus),
                weight: 1,
                opacity: 1,
                color: 'white',
                fillOpacity: 0.8
            };
        },
        onEachFeature: function(feature, layer) {
            const pctId = feature.properties.NAME;
            const data = electionData[pctId];
            
            if (data) {
                let totalVotes = 0;
                const candidates = Object.keys(data).filter(key => key !== 'Precinct' && typeof data[key] === 'number');
                candidates.forEach(key => totalVotes += data[key]);
                
                let tooltipContent = `
                    <div style="font-family: Arial, sans-serif;">
                        <strong>Precinct ${pctId}</strong><br/>
                        <hr style="margin: 4px 0;"/>
                `;
                
                candidates.sort((a, b) => (data[b] || 0) - (data[a] || 0));
                
                candidates.forEach(cand => {
                    const votes = data[cand] || 0;
                    const pct = totalVotes ? ((votes / totalVotes) * 100).toFixed(1) : 0;
                    
                    if (opponent && (cand === opponent || cand === mainCandidate)) {
                        tooltipContent += `<span style="background-color: #ffff99; padding: 2px;">${cand}: <strong>${pct}%</strong></span><br/>`;
                    } else {
                        tooltipContent += `${cand}: <strong>${pct}%</strong><br/>`;
                    }
                });
                
                tooltipContent += `</div>`;
                layer.bindTooltip(tooltipContent);
            }
        }
    }).addTo(map);
}

function getColor(winStatus) {
    if (winStatus === "DWS") return '#08519c'; 
    if (winStatus === "Opponent") return '#cc4c02'; 
    return '#f0f0f0'; 
}