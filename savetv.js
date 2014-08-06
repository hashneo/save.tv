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
		var dest = res.headers['content-disposition'].split(';')[1].replace(' filename=','');
		var tmp = dest + '.tmp';
		var file = fs.createWriteStream(tmp);
	    res.pipe(file);
	    file.on('finish', function() {
	      	file.close(complete);
	      	fs.rename(tmp,dest);
    	});
	});
}

function call(url, method, data, type, success, error){
	var options = {
	    host : 'www.save.tv',
	    port : 443,
	    path : url,
	    method : method,
	    headers : { "accept" : "text/html" }
	};

	if ( data === undefined )
		data = null;

	if ( data !== null ){		
		options.headers['Content-Type'] = type,
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
    	call( '/STV/M/obj/cRecordOrder/croGetDownloadUrl.cfm?TelecastId=' + entry.ITELECASTID + '&iFormat=' + entry.IRECORDINGFORMATID + '&bAdFree=false', 'GET', null, null, resolve, reject );
    }).then( function(data){
    	var recordingData = JSON.parse(data);

    	var dlUrl = recordingData.ARRVIDEOURL[2];
		download( dlUrl, function() { 
			db.insert(entry, function (err, newDoc) {
				console.log('marked recording => ' + entry.ITELECASTID + ', complete');
				complete();
			});
		});

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

		// Finding all planets in the solar system
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
		call( '/STV/M/obj/archive/JSON/VideoArchiveApi.cfm?iEntriesPerPage=10&iCurrentPage=' + pgNum, 'GET', null, null, function(data){
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
	call( '/STV/M/Index.cfm?sk=PREMIUM', 'POST', 'sUsername=' + user + '&sPassword=' + password + '&value=Login', ' application/x-www-form-urlencoded', loadList );
}

run( ops.user, ops.password, function(){} );
