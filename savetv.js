var Datastore = require('nedb'), 
	db = new Datastore({ filename: './data.db', autoload: true });

var fs = require('fs');

var  http = require('http'),
 	 https = require('https')

var tough = require('tough-cookie'),
	Cookie = tough.Cookie;

var cookiejar = new tough.CookieJar();

var Promise = require('es6-promise').Promise;

var forAllAsync = exports.forAllAsync || require('forallasync').forAllAsync, 
	maxCallsAtOnce = 3;

var stdio = require('stdio');

var ops = stdio.getopt({
    'user': {key: 'u', args: 1, mandatory: true, description: 'Save.TV username'},
    'password': {key: 'p', args: 1, mandatory: true, description: 'Password'},
    'threads': {key: 't', args: 1 , description: 'How many simultaneous shows to download (max 3)'},
    /*'delete': {key: 'd', description: 'delete downloaded shows'},*/
});

if ( ops.threads ){
	maxCallsAtOnce = ops.args[2];
	if ( maxCallsAtOnce <= 0 || maxCallsAtOnce > 3 ) maxCallsAtOnce = 3;
}

function download(url, complete) {
	var request = http.get(url, function(res) {
		if ( res.headers['content-disposition'] === undefined ){
			console.log('url => \'' +url + '\' didn\'t return content-disposition in the header');
			console.log('STATUS: ' + res.statusCode);
			console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
			  console.log('BODY: ' + chunk);
		 	});
		 	res.on('end', function() {
				complete(false);
  			});
			return;
		}
		var dest = res.headers['content-disposition'].split(';')[1].replace(' filename=','');
		var tmp = dest + '.tmp';
		var file = fs.createWriteStream(tmp);
	    res.pipe(file);
	    file.on('finish', function() {
	      	file.close( function(){ complete(true);} );
	      	fs.rename(tmp,dest);
    	});
	});
}

function call(url, method, data, type, accept, success, error){
	var options = {
	    host : 'www.save.tv',
	    port : 443,
	    path : url,
	    method : method,
	    headers : { "accept" : accept || "text/html"}
	};

	if ( data === undefined )
		data = null;

	if ( data !== null ){		
		options.headers['Content-Type'] = type;
        options.headers['Content-Length'] = data.length;
	}

	cookiejar.getCookies('https://www.save.tv' + url ,function(err,cookies) {
	  options.headers['cookie'] = cookies.join('; ');
	});

	console.log( options.path );

	// do the request
	var req = https.request(options, function(res) {
		var data = '';
	    //console.log("statusCode: ", res.statusCode);
	  	//console.log("headers: ", res.headers);

		if (res.headers['set-cookie'] instanceof Array)
			res.headers['set-cookie'].map(function (c) { cookiejar.setCookieSync( c, 'https://www.save.tv' + url ); });

	    res.on('data', function(block) {
	        data += block;
	    });

	    res.on('end',function(){
	    	try{
	    		if ( success !== undefined )
	    			success(data);		    		
	    	}
	    	catch(e){
	    		console.log(options);
	    		console.log(e);
	    		if ( error !== undefined ){
	    			error([options, e]);
	    		}
	    	}
    	});
	});

	if ( data !== null ){		
		req.write(data);
	}

	req.end();
	req.on('error', function(e) {
	    console.error(e);
	});		
}


function processArchive( complete, entry, i ){
	console.log('processing recording => ' + entry.ITELECASTID );
	new Promise( function (resolve, reject) {

        entry.ARRALLOWDDOWNLOADFORMATS.forEach( function(format){
            if ( format.SNAME === 'H.264 SD' && !entry.IRECORDINGFORMATID)
                entry.IRECORDINGFORMATID = format.RECORDINGFORMATID;

            if ( format.SNAME === 'H.264 HD')
                entry.IRECORDINGFORMATID = format.RECORDINGFORMATID;
        });

    	call( '/STV/M/obj/cRecordOrder/croGetDownloadUrl2.cfm?TelecastId=' + entry.ITELECASTID + '&iFormat=' + entry.IRECORDINGFORMATID + '&bAdFree=false', 'GET', null, null, 'application/json', resolve, reject );
    }).then( function(data){
    	var recordingData = JSON.parse(data);

		if ( recordingData.SUCCESS ){
			var dlUrl = recordingData.DOWNLOADURL;
			download( dlUrl, function(completed) {
				if ( completed ){
					db.insert(entry, function (err, newDoc) {
						console.log('marked recording => ' + entry.ITELECASTID + ', complete');
						complete();
					});
				}
			});
		}
    	//console.log(data);
    }).then( function(){
   });
}

var Entries = [];

function processList( ){
	//console.log(data);

	var processList = [];

	function searchDatabase( complete, entry, i ){
		if ( entry.STRTELECASTENTRY !== undefined )
			entry = entry.STRTELECASTENTRY;

		//set our primary key for the db
		entry['_id'] = entry.ITELECASTID;

		// Finding all shows with the same id
		db.find({ _id: entry['_id'] }, function (err, docs) {
			// nothing found
			if ( docs.length == 0 ){
				console.log('adding new recording => ' + entry.ITELECASTID + ', title => ' + entry.STITLE );
				processList.push( entry );
			}
			complete();
		});		
	}

	forAllAsync( Entries, searchDatabase, 10 ).then(function () {
		forAllAsync( processList, processArchive, maxCallsAtOnce ).then(function () {
	    	console.log('did all the things');
	    	// Logout
	    	logout();
		});	
	});

}


function loadList(){

	function loadListPage( pgNum, onComplete ){
		var startDate = new Date( (new Date()).setDate( (new Date()).getDate() - 30 ) ).toISOString().slice(0,10)
		var endDate = new Date().toISOString().slice(0,10)

		call( '/STV/M/obj/archive/JSON/VideoArchiveApi.cfm?iEntriesPerPage=10&iCurrentPage=' + pgNum + '&dStartdate=' + startDate + '&dEnddate=' + endDate, 'GET', null, null, null, function(data){
			var jsonData = JSON.parse(data);
			Entries = Entries.concat(jsonData.ARRVIDEOARCHIVEENTRIES);
			if ( jsonData.ICURRENTPAGE < jsonData.ITOTALPAGES ){
				loadListPage( pgNum + 1, onComplete )
			} else {
				onComplete();
			}
		}, function(e){ throw e }  );
	}

	loadListPage( 1, function(){ processList() } );
}

function logout( success ){
	call( '/STV/M/obj/user/usLogout.cfm', 'GET' );
	sessionCookie = null;
}

function run( user, password, success ){
	call( '/STV/M/Index.cfm?sk=PREMIUM', 'POST', 'sUsername=' + user + '&sPassword=' + password + '&value=Login', ' application/x-www-form-urlencoded', null, loadList );
}

run( ops.user, ops.password, function(){} );
