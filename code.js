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

// Load the FeatureCollection from Earth Engine
var predictors_polygons = ee.FeatureCollection("projects/stgee-dataset/assets/polygons_gridcoll");
var landPoints = ee.FeatureCollection("projects/stgee-dataset/assets/pointsDate");

// Check if the collections are defined and not empty
if (predictors_polygons && predictors_polygons.size().getInfo() > 0 && landPoints && landPoints.size().getInfo() > 0) {
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

    // Determine presence/absence (P/A)
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

  // Apply the function to the updated polygons
  var outputPredictors_7d = updatedPolygons.map(function (feature) {
    return addCumulativeRainfall(feature, 7);
  });

  var outputPredictors_14d = updatedPolygons.map(function (feature) {
    return addCumulativeRainfall(feature, 14);
  });

  // Return the results wrapped in a function
  exports.preProcessing = function(predictors_polygons, otherParams, landPoints, otherParams1, otherParams2, otherParams3) {
    return {
      outputPredictors_7d: outputPredictors_7d,
      outputPredictors_14d: outputPredictors_14d
    };
  };

  // Apply the preprocessing function
  var results = exports.preProcessing(predictors_polygons, null, landPoints, null, null, null);

  // Extract the datasets for 7-day and 14-day rainfall
  var features_7d = results.outputPredictors_7d;
  var features_14d = results.outputPredictors_14d;

  // Print the results
  print('Features with P/A = 1 (7-day):', features_7d.filter(ee.Filter.eq('P/A', 1)).limit(10));
  print('Features with P/A = 1 (14-day):', features_14d.filter(ee.Filter.eq('P/A', 1)).limit(10));

  // // Export the features to Google Drive as GeoJSON
  // Export.table.toDrive({
  //   collection: features_7d,
  //   description: '7_day_rainfall',
  //   fileFormat: 'GeoJSON'
  // });

  // Export.table.toDrive({
  //   collection: features_14d,
  //   description: '14_day_rainfall',
  //   fileFormat: 'GeoJSON'
  // });
}
