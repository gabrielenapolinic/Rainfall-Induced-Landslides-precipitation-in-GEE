//////////////////////////////////////////////////////////////////////////////////////////
/*

***************************************************************************
see: Maria Teresa Brunetti, Massimo Melillo, 
Stefano Luigi Gariano, Fausto Guzzetti, Devis Bartolini, Francesca Brutti, 
Cinzia Bianchi, Costanza Calzolari, Barbara Denti, Eleonora Gioia, Silvia Luciani,
Maria Elena Martinotti, Michela Rosa Palladino, Luca Pisano, Anna Roccati, Monica Solimano, 
Carmela Vennari, Giovanna Vessia, Alessia Viero, & Silvia Peruccacci. (2023). 
ITALICA (ITAlian rainfall-induced LandslIdes CAtalogue) (Version 2) [Data set]. 
Zenodo. https://doi.org/10.5281/zenodo.8009366

***************************************************************************

see: M. Alvioli, I. Marchesini, P. Reichenbach, M. Rossi, F. Fiorucci, F. Ardizzone, F. Guzzetti (https://doi.org/10.5194/gmd-9-3975-2016)         
and: M. Alvioli, F. Guzzetti, I.Marchesini (https://doi.org/10.1016/j.geomorph.2020.107124)        
and references therein for explanations, examples and additional options.        

please address comments, questions and bug fixes rquests either to:         
ivan.marchesini[AT]irpi.cnr.it;       
massimiliano.alvioli[AT]irpi.cnr.it       
	
***************************************************************************

*/

// Load the points FeatureCollection
var points = ee.FeatureCollection('projects/ee-gabrielenicolanapoli/assets/Marche_Lasli/ITALICA_Marche_with_dates');
Map.centerObject(points, 9);

// Load the secondary collection: Polygons (SlUnit)
var polygons = ee.FeatureCollection('projects/ee-gabrielenicolanapoli/assets/Marche_Lasli/SU_RegMarche');
Map.addLayer(polygons, { palette: '#ed7000' }, 'polygons');

// Define a spatial filter to find geometries that intersect.
var spatialFilter = ee.Filter.intersects({
  leftField: '.geo',
  rightField: '.geo',
  maxError: 10
});

// Perform the spatial join and save all overlapping polygons as a list for each point
var intersectJoined = ee.Join.saveAll({
  matchesKey: 'points',
}).apply({
  primary: points,
  secondary: polygons,
  condition: spatialFilter,
});

//////////////////////////////////////////////////////////////////////////////////////////
// Monthly time series rainfall

// Load the precipitation ImageCollection
var precipitation = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate('2002-07-16', '2018-05-03')
  .filterBounds(points.geometry());

// Define a function to combine date and time information
function combineDateAndTime(image) {
  var index = ee.String(image.get('system:index'));
  var year = ee.Number.parse(index.slice(0, 4));
  var month = ee.Number.parse(index.slice(4, 6));
  var day = ee.Number.parse(index.slice(6, 8));
  var date = ee.Date.fromYMD(year, month, day);

  var timeStart = ee.Number(image.get('system:time_start'));
  var hours = ee.Number(timeStart.divide(100000000000).int());
  var minutes = ee.Number(timeStart.divide(1000000000).mod(100).int());

  // Convert the date and time to Rome timezone (UTC+2)
  var dateInRome = date.advance(2, 'hour');

  // Create a formatted string for the date and time
  var formattedDate = ee.String(dateInRome.format('yyyy-MM-dd')).cat(' ')
    .cat(ee.Number(hours).format('%02d')).cat(':')
    .cat(ee.Number(minutes).format('%02d')).cat(':00');

  return image.set('formatted_date', formattedDate);
}

// Apply the combined function to each image in the collection
var collectionWithFormattedDate = precipitation.map(combineDateAndTime);

// Define a function to get the precipitation value for each image
var precipitationValues = collectionWithFormattedDate.map(function(image) {
  var value = ee.Image(image).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: points.geometry(),
    scale: 5000
  }).get('precipitation');
  return image.set('precipitation', value);
});

// Print the first image with the new properties
print(precipitationValues.limit(50), 'precipitationValues');

// Define visualization parameters for rainfall
var rainfallVis = {
  min: 1.0,
  max: 17.0,
  palette: ['0300ff', '418504', 'efff07', 'efff07', 'ff0303']
};

// Map.addLayer(precipitationValues, rainfallVis, 'precipitationValues');

//////////////////////////////////////////////////////////////////////////////////////////
// Convert 'utc_date' to date format with Rome Timezone

var convertToDate = function(feature) {
  var dateString = ee.String(feature.get('utc_date'));
  
  // Extract the date from the 'utc_date' string
  var datePart = dateString.slice(0, 10);
  
  // Extract the hours (HH) and minutes (mm) from the 'utc_date' string
  var hours = dateString.slice(11, 13);
  var minutes = dateString.slice(14, 16);
  
  // Check if seconds are present in the string
  var hasSeconds = dateString.length() >= 19;
  
  // Add seconds if present, otherwise set them to '00'
  var seconds = hasSeconds ? dateString.slice(17, 19) : '00';
  
  // Create a new string with the hours, minutes, and seconds
  var timeString = ee.String(hours).cat(':').cat(minutes).cat(':').cat(seconds);
  
  // Combine the date and time parts
  var formattedDateString = ee.String(datePart).cat(' ').cat(timeString);
  
  // Convert the new string to an ee.Date object
  var date = ee.Date.parse('dd/MM/yyyy HH:mm:ss', formattedDateString);

  // // Add the 2-hour offset for Rome timezone
  // var dateWithOffset = date.advance(2, 'hour');
  
  return feature.set('date', date);
};

// Apply the function to each feature in the FeatureCollection
var pointsWithDate = points.map(convertToDate);

print(pointsWithDate.first(), 'pointsWithDate');

// Visualize the FeatureCollection on the map
Map.addLayer(pointsWithDate, { color: 'FF0000' }, 'suWithDate');

//////////////////////////////////////////////////////////////////////////////////////////
// Filter features based on CHIRPS dates

// Filter the Feature Collection based on the landslide date
var landslideDate = ee.Date("date");
var landslideFeatures = pointsWithDate.filterDate(landslideDate, landslideDate.advance(1, 'day'));

// Load the CHIRPS dataset as an ImageCollection
var chirpsCollection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY");

// Filter the CHIRPS ImageCollection using the landslide date
var chirpsImage = chirpsCollection.filterDate(landslideDate, landslideDate.advance(1, 'day')).first();

// Calculate the mean precipitation value for the landslide geometry
var precipitation = chirpsImage.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: landslideFeatures.geometry(),
  scale: 5000,
});

// Add the precipitation value as a property to the Feature Collection
var landslidesWithPrecipitation = landslideFeatures.map(function(feature) {
  return feature.set('precipitation', precipitation.get('precipitation'));
});

//////////////////////////////////////////////////////////////////////////////////////////
// Matching dates and creation of stdDev, mean, min, and max:

var matching = function (feat){
  var day = ee.Date(feat.get('date')).getRange('day');
 var precipitation = chirpsCollection.filterDate(day).first();

  var ReduceValues = precipitation.reduceRegion({
    reducer: ee.Reducer.mean().combine({
    reducer2: ee.Reducer.stdDev(),
    sharedInputs: true
    }),
    geometry: feat.geometry(),
    scale: 30,
  });
  
  var feature = ee.Feature(feat.geometry(), ReduceValues);
  return feature.set('date', ee.Date(feat.get('date')))
};

var mappedFeatures = pointsWithDate.map(matching);
print(mappedFeatures, 'mappedFeatures');

//-------------------------------------------------------------------------------

var matching1 = function (feat){
  var day = ee.Date(feat.get('date')).getRange('day');
 var precipitation = chirpsCollection.filterDate(day).first();

  var ReduceValues = precipitation.reduceRegion({
    reducer: ee.Reducer.min().combine({
    reducer2: ee.Reducer.max(),
    sharedInputs: true
    }),
    geometry: feat.geometry(),
    scale: 30,
  });
  
  var feature = ee.Feature(feat.geometry(), ReduceValues);
  var feature2 = feature.set('precipitation_mean', feat.get('precipitation_mean'));
  var feature3 = feature2.set('precipitation_stdDev', feat.get('precipitation_stdDev'));
  
  return feature3.set('date', ee.Date(feat.get('date')));
};

var mappedFeatures2 = mappedFeatures.map(matching1);
// print(mappedFeatures2);
print(mappedFeatures2.limit(50), 'mappedFeatures2');

Map.addLayer(mappedFeatures2, {}, 'mappedFeatures2');

//////////////////////////////////////////////////////////////////////////////////////////
// Add a new property 'SU_counter' indicating the count of polygons each point intersects with
var pointsWithSUCounter = mappedFeatures2.map(function(feature) {
  var polygonsIntersected = ee.FeatureCollection(polygons.filterBounds(feature.geometry()));
  var suCounter = polygonsIntersected.size();
  return feature.set('SU_counter', suCounter);
});

//////////////////////////////////////////////////////////////////////////////////////////
// Add a new property 'SU_ids' listing the IDs of polygons each point intersects with
var pointsWithSUIds = pointsWithSUCounter.map(function(feature) {
  var polygonsIntersected = ee.FeatureCollection(polygons.filterBounds(feature.geometry()));
  var suIds = polygonsIntersected.aggregate_array('id');
  return feature.set('SU_ids', suIds);
});

print(pointsWithSUIds.limit(50), 'pointsWithSUIds');

Map.addLayer(pointsWithSUIds, {}, 'pointsWithSUIds');

//-------------------------------------------------------------------------------
//-------------------------------------------------------------------------------

// Export the Feature Collection with added properties as a CSV file
Export.table.toDrive({
  collection: pointsWithSUIds,
  folder: 'Mean_Rain',
  description: 'Points_With_Properties_Precip',
  fileFormat: 'GeoJSON',
});

