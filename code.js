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

// Load the FeatureCollection with predictor polygons
var predictors_polygons = ee.FeatureCollection('projects/stgee-dataset/assets/polygons_gridcoll_14-11-2024');

// Load the FeatureCollection with landslide points
var landPoints = ee.FeatureCollection('projects/stgee-dataset/assets/pointsDate');

// Function to clean up the index (reset system:index)
function cleanupIndex(featureCollection) {
  var featureCollection = ee.FeatureCollection(featureCollection);
  var idList = ee.List.sequence(0, featureCollection.size().subtract(1));
  var list = featureCollection.toList(featureCollection.size());

  var outFeatureCollection = idList.map(function (newSysIndex) {
    var feat = ee.Feature(list.get(newSysIndex));
    var indexString = ee.String('').cat(ee.Number(newSysIndex).format("%d"));
    return feat.set("system:index", indexString);
  });

  return ee.FeatureCollection(outFeatureCollection);
}

// Clean up the index for both collections
var newLandPoints = cleanupIndex(landPoints);
var newPredictorsPolygons = cleanupIndex(predictors_polygons);

// Variables for date and feature ID fields
var dateField = 'formatted_date';
var fidField = 'id';

// Identify overlapping points between polygons and landslide points
var overlappingPoints = newLandPoints.filterBounds(newPredictorsPolygons);

// Function to process polygons by adding fields from overlapping points
var updatedPolygons = newPredictorsPolygons.map(function (polygon) {
  // Filter points that fall within the current polygon
  var matchedPoints = overlappingPoints.filterBounds(polygon.geometry());

  // Aggregate the first occurrence of the date and ID fields from matched points
  var formattedDate = matchedPoints.aggregate_first(dateField);
  var id = matchedPoints.aggregate_first(fidField);

  // Determine presence/absence (P/A) based on matching points
  var presenceAbsence = ee.Algorithms.If(
    matchedPoints.size().gt(0),
    1, // 1 if there are points
    0  // 0 otherwise
  );

  // Set the new fields in the polygon
  return polygon
    .set(dateField, formattedDate)
    .set(fidField, id)
    .set('P/A', presenceAbsence);
});

// Load the GPM GSMaP ImageCollection for rainfall data
var gpmGSMaP = ee.ImageCollection('JAXA/GPM_L3/GSMaP/v8/operational');

// Function to add cumulative rainfall
function addCumulativeRainfall(feature, days) {
  var date = ee.Date(feature.get(dateField));

  // Check if the date field exists
  var hasValidDate = feature.get(dateField);

  return ee.Algorithms.If(
    hasValidDate, // Verify the date field is not null
    (function () {
      var startDate = date.advance(-days, 'day');
      var gpmImages = gpmGSMaP.filterDate(startDate, date).select('hourlyPrecipRateGC');

      // Compute sum and standard deviation of rainfall
      var gpmSumImage = gpmImages.sum();
      var rainfallMean = gpmSumImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: feature.geometry(),
        scale: 1000,
        maxPixels: 5e12
      }).get('hourlyPrecipRateGC');

      var rainfallStdDev = gpmImages.reduce(ee.Reducer.stdDev()).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: feature.geometry(),
        scale: 1000,
        maxPixels: 5e12
      }).get('hourlyPrecipRateGC_stdDev');

      return feature
        .set('CumRn_' + days + 'd_mean', rainfallMean)
        .set('CumRn_' + days + 'd_std', rainfallStdDev);
    })(),
    feature
      .set('CumRn_' + days + 'd_mean', 0) // Set null values if date is missing
      .set('CumRn_' + days + 'd_std', 0)
  );
}

// Apply the function to the updated polygons for 7 and 14 days
var outputPredictors_7d = updatedPolygons.map(function (feature) {
  return addCumulativeRainfall(feature, 7);
});

var outputPredictors_14d = updatedPolygons.map(function (feature) {
  return addCumulativeRainfall(feature, 14);
});

// Visualize the results on the map
Map.addLayer(outputPredictors_7d, { color: 'red' }, 'Predictors with 7-Day Rainfall');
Map.addLayer(outputPredictors_14d, { color: 'blue' }, 'Predictors with 14-Day Rainfall');
Map.centerObject(predictors_polygons, 12);

// Add landslide points to the map for visualization
Map.addLayer(landPoints, {color: 'red'}, 'Landslide Points');

// Export the results (uncomment to use)
// Export.table.toDrive({
//   collection: outputPredictors_7d,
//   description: 'Filtered_7d_Rainfall',
//   fileFormat: 'CSV'
// });
// Export.table.toDrive({
//   collection: outputPredictors_14d,
//   description: 'Filtered_14d_Rainfall',
//   fileFormat: 'CSV'
// });

