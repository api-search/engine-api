const vandium = require('vandium');
const mysql  = require('mysql');
const https  = require('https');
const Ajv = require("ajv")
const ajv = new Ajv({allErrors: true,strict: false}) // options can be passed, e.g. {allErrors: true}
const AWS = require("aws-sdk");

const s3 = new AWS.S3({
  accessKeyId: process.env.key,
  secretAccessKey: process.env.secret, 
  Bucket: "kinlane-productions2"
});

exports.handler = vandium.generic()
  .handler( (event, context, callback) => {

    var connection = mysql.createConnection({
    host     : process.env.host,
    user     : process.env.user,
    password : process.env.password,
    database : process.env.database
    });

    let currentDate = new Date();
    let startDate = new Date(currentDate.getFullYear(), 0, 1);
    let days = Math.floor((currentDate - startDate) / (24 * 60 * 60 * 1000));
     
    const weekNumber = Math.ceil(days / 7);    
    
    var sql = "SELECT type,url,api_base_url FROM properties WHERE pulled <> " + weekNumber + ' LIMIT 1';
    connection.query(sql, function (error, results, fields) { 
      
        if(results && results.length > 0){
            
          // Pull any new ones.
          var api_base_url = results[0].api_base_url;
          //console.log(api_base_url);
          var property_type = results[0].type;
          //console.log(property_type);
          var property_url = results[0].url;
          //console.log(property_url);

          var property_slug = property_url.replace('http://','http-');
          property_slug = property_slug.replace('.json','');
          property_slug = property_slug.replace('.yaml','');
          property_slug = property_slug.replace('https://','https-');
          property_slug = property_slug.replace(/\//g, '-');
          property_slug = property_slug.replace('.','-');

          var save_property_path = 'apis-io/api/apis-json/properties/' + property_slug + "/" + weekNumber + "/property.txt";

            https.get(property_url, (res)=>{
              
              let data = [];
              const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
              
              //console.log('Status Code:', res.statusCode);
              //console.log('Date in Response header:', headerDate);
            
              res.on('data', chunk => {
                data.push(chunk);
              });
            
              res.on('end', () => {
                
                //console.log('Response ended: ');

                if(!error && res.statusCode == 200){
                  
                  // Success - Record Run
                  const property_content = Buffer.concat(data).toString();

                  var outcome = {};
                  outcome.status = res.statusCode;
                  outcome.property_content = property_content;
                  outcome.save_property_path = save_property_path;

                  var sql = "UPDATE properties SET pulled = " + connection.escape(weekNumber) + ",status = " + connection.escape(res.statusCode) + ",path = " + connection.escape(save_property_path) + ",slug = " + connection.escape(property_slug) + " WHERE api_base_url = " + connection.escape(api_base_url) + " AND url = " + connection.escape(property_url);
                  outcome.sql = sql;
                  connection.query(sql, function (error, results, fields) {                  

                    var sql1 = "DELETE FROM properties_pull WHERE url = '" + property_url + "' AND week = " + weekNumber;
                    outcome.sql1 = sql1;
                    connection.query(sql1, function (error1, results1, fields) { 
                      
                      var sql2 = "INSERT INTO properties_pull(pulled,url,status) VALUES(" + connection.escape(weekNumber) + "," + connection.escape(property_url) + "," + connection.escape(res.statusCode) + ")";
                      outcome.sql2 = sql2;
                      connection.query(sql2, function (error2, results2, fields) {     

                        // Write to S#
                        var buf = Buffer.from(property_content);

                        var params = {
                            Bucket: 'kinlane-productions2',
                            Key: save_property_path,
                            Body: buf,
                            ContentEncoding: 'base64',
                            ContentType: 'application/json',
                            ACL: 'public-read'
                        };

                        //console.log(params);  

                        s3.putObject(params, function (err, data) {
                            if (err) {
                                reject(err)
                            } else {
                                  
                                  //console.log("Successfully uploaded data to bucket");
                                  
                                  outcome.data = data;

                                  outcome = {};
                                  outcome.message = "200 - " + property_type + " - " + property_url + ".";

                                  callback( null, outcome );     
                            }
                        });                                  
                                          


                      });
                    });   

                  });

                }
                else{

                  // Problem -- Record Run
                  var outcome = {};
                  outcome.status = res.statusCode;
                  outcome.property_content = '';
                  outcome.save_property_path = '';

                  var sql = "UPDATE properties SET pulled = " + connection.escape(weekNumber) + ",status = " + connection.escape(res.statusCode) + ",path = '' WHERE api_base_url = " + connection.escape(api_base_url) + " AND url = " + connection.escape(property_url);
                  outcome.sql = sql;
                  connection.query(sql, function (error, results, fields) {                  

                    var sql1 = "DELETE FROM properties_pull WHERE url = '" + property_url + "' AND week = " + weekNumber;
                    outcome.sql1 = sql1;
                    connection.query(sql1, function (error1, results1, fields) { 
                      
                      var sql2 = "INSERT INTO properties_pull(pulled,url,status) VALUES(" + connection.escape(weekNumber) + "," + connection.escape(property_url) + "," + connection.escape(res.statusCode) + ")";
                      outcome.sql2 = sql2;
                      connection.query(sql2, function (error2, results2, fields) {     

                        outcome = {};
                        outcome.message = res.statusCode + " - " + property_type + " - " + property_url + ".";

                        callback( null, outcome );

                      });
                    }); 

                  });   

                }

              });

            });

        }
        else{

          outcome = {};
          //outcome.sql = sql;
          outcome.message = "No more properties to pull.";

          callback( null, outcome );

        }

    });
}); 