// Initialize the map with default zoom controls disabled
const map = L.map('map', {
    zoomControl: false
}).setView([26.15, -80.25], 11);

// Re-add Zoom Controls to the TOP RIGHT
L.control.zoom({
    position: 'topright'
}).addTo(map);

// Add a clean, light basemap
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO'
}).addTo(map);

// Add Address Search Bar
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

// Allowed Democratic candidates
const allowedCandidates = [
    "Debbie Wasserman Schultz",
    "Dale Holness",
    "Elijah Manley",
    "Sheila Cherfilus-McCormick",
    "Luther Campbell"
];
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
    const opponents = allowedCandidates.filter(col => col !== mainCandidate);
    
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
    
    let oppLastName = "Opponent";
    if (opponent) {
        const nameParts = opponent.trim().split(" ");
        oppLastName = nameParts[nameParts.length - 1];
    }

    // Dynamic Gradient Legend UI
    const oppLabel = opponent ? oppLastName : "Opponent";
    
    document.querySelector('.legend').innerHTML = `
        <div style="font-weight:bold; margin-bottom:4px; font-size:11px;">DWS Margin</div>
        <div><span style="background:#08306b"></span> DWS +30%+</div>
        <div><span style="background:#2171b5"></span> DWS +15% to 30%</div>
        <div><span style="background:#6baed6"></span> DWS +5% to 15%</div>
        <div><span style="background:#c6dbef"></span> DWS &lt;5%</div>
        <hr style="margin: 6px 0; border:0; border-top:1px solid #ddd;"/>
        <div style="font-weight:bold; margin-bottom:4px; font-size:11px;">${oppLabel} Margin</div>
        <div><span style="background:#fcc5e3"></span> ${oppLabel} &lt;5%</div>
        <div><span style="background:#f768a1"></span> ${oppLabel} +5% to 15%</div>
        <div><span style="background:#ae017e"></span> ${oppLabel} +15% to 30%</div>
        <div><span style="background:#49006a"></span> ${oppLabel} +30%+</div>
        <hr style="margin: 6px 0; border:0; border-top:1px solid #ddd;"/>
        <div><span style="background:#f0f0f0"></span> No data / &lt;10 votes</div>
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
            allowedCandidates.forEach(key => {
                if (typeof data[key] === 'number') {
                    totalVotes += data[key];
                }
            });

            if (totalVotes < 10) {
                return { color: 'white', fillColor: '#f0f0f0', weight: 1, fillOpacity: 0.8 };
            }

            let winner = "";
            let margin = 0;

            if (!opponent) {
                // Find top 2 candidates to compute runner-up margin
                let sorted = allowedCandidates
                    .map(cand => ({ name: cand, votes: data[cand] || 0 }))
                    .sort((a, b) => b.votes - a.votes);
                
                winner = sorted[0].name;
                const topVotes = sorted[0].votes;
                const runnerUpVotes = sorted[1] ? sorted[1].votes : 0;
                margin = (topVotes - runnerUpVotes) / totalVotes;
            } else {
                // Head-to-head margin
                const mainVotes = data[mainCandidate] || 0;
                const oppVotes = data[opponent] || 0;
                
                if (mainVotes >= oppVotes) {
                    winner = mainCandidate;
                    margin = (mainVotes - oppVotes) / totalVotes;
                } else {
                    winner = opponent;
                    margin = (oppVotes - mainVotes) / totalVotes;
                }
            }

            return {
                fillColor: getGradientColor(winner, margin),
                weight: 1,
                opacity: 1,
                color: 'white',
                fillOpacity: 0.85
            };
        },
        onEachFeature: function(feature, layer) {
            const pctId = feature.properties.NAME;
            const data = electionData[pctId];
            
            if (data) {
                let totalVotes = 0;
                allowedCandidates.forEach(key => {
                    if (typeof data[key] === 'number') {
                        totalVotes += data[key];
                    }
                });
                
                let tooltipContent = `
                    <div style="font-family: Arial, sans-serif;">
                        <strong>Precinct ${pctId}</strong><br/>
                `;

                if (totalVotes < 10) {
                    tooltipContent += `<span style="color:#666; font-size:11px;">(Fewer than 10 total Dem votes)</span><br/>`;
                }
                
                tooltipContent += `<hr style="margin: 4px 0;"/>`;
                
                const sortedCandidates = [...allowedCandidates].sort((a, b) => (data[b] || 0) - (data[a] || 0));
                
                sortedCandidates.forEach(cand => {
                    const votes = data[cand] || 0;
                    const pct = totalVotes ? ((votes / totalVotes) * 100).toFixed(1) : 0;
                    
                    if (opponent && (cand === opponent || cand === mainCandidate)) {
                        tooltipContent += `<span style="background-color: #ffff99; padding: 2px;">${cand}: <strong>${pct}%</strong> (${votes})</span><br/>`;
                    } else {
                        tooltipContent += `${cand}: <strong>${pct}%</strong> (${votes})<br/>`;
                    }
                });
                
                tooltipContent += `</div>`;
                layer.bindTooltip(tooltipContent);
            }
        }
    }).addTo(map);
}

function getGradientColor(winner, margin) {
    if (winner === mainCandidate) {
        // DWS Blue Shades
        if (margin >= 0.30) return '#08306b'; // Deep Navy
        if (margin >= 0.15) return '#2171b5'; // Medium Dark Blue
        if (margin >= 0.05) return '#6baed6'; // Medium Blue
        return '#c6dbef';                     // Soft Light Blue
    } else {
        // Opponent Magenta Shades
        if (margin >= 0.30) return '#49006a'; // Deep Plum/Dark Magenta
        if (margin >= 0.15) return '#ae017e'; // Rich Magenta
        if (margin >= 0.05) return '#f768a1'; // Bright Pink/Magenta
        return '#fcc5e3';                     // Soft Light Pink
    }
}