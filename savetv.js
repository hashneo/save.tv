const Datastore = require('nedb'),
	  db = new Datastore({ filename: './download/data.db', autoload: true });

const fs = require('fs-extra');
const path = require('path');

const  http = require('http'),
 	 https = require('https');

const keepAliveAgent = {
    http: new http.Agent({ keepAlive: true }),
    https: new https.Agent({ keepAlive: true })
};

const forAllAsync = exports.forAllAsync || require('forallasync').forAllAsync;

var maxCallsAtOnce = 1;

const stdio = require('stdio');

var request = require('request');

request = request.defaults({jar: true});

var ProgressBar;

if (!process.env.DEBUG) {
    ProgressBar = require('ascii-progress');
}

const url = require('url');

//require('request-debug')(request);

const progress = require('request-progress');

const ops = stdio.getopt({
    'user': {key: 'u', args: 1, mandatory: true, description: 'Save.TV username'},
    'password': {key: 'p', args: 1, mandatory: true, description: 'Password'},
    'threads': {key: 't', args: 1 , description: 'How many simultaneous shows to download (max 3)'},
    /*'delete': {key: 'd', description: 'delete downloaded shows'},*/
});

if ( ops.threads ){
	maxCallsAtOnce = ops.threads;
	if ( maxCallsAtOnce <= 0 || maxCallsAtOnce > 6 ) maxCallsAtOnce = 1;
}

let pbars = {};

function download(title, href) {

    return new Promise( (fulfill, reject) =>{

        let dest;
        let file;
        let tmp;

        let fname;

        let r;

        let state = { size : { transferred : 0, total : 0 } };

        let wpath = path.join( __dirname, 'download' );
        fs.ensureDirSync(wpath);

        const resourceUrl = url.parse( href );

        let re = /http:\/\/.*\.save\.tv\/(.*)\/\?.*/;

        let m = href.match(re);

        if (!m){
            return reject( new Error('invalid download url ->' + href))
        }

        tmp = path.join( wpath, m[1] + '.tmp' );

        let s;

        if ( fs.existsSync(tmp) ) {
            s = fs.statSync( tmp );
            state.size.transferred = s.size;
            state.size.total = state.size.transferred;
            file = fs.createWriteStream(tmp, { flags: 'r+', start: s.size });
        } else {
            file = fs.createWriteStream(tmp);
        }

        let options = {
            url: href,
            gzip: true,
            timeout: 30000,
            agent: keepAliveAgent.http
        };

        if ( state.size.transferred > 0 ) {
            options['headers'] = {
                Range : 'bytes=' + state.size.transferred + '-'
            }
        }

        try {
            request.get(options)
                .on('abort', function () {
                    console.log('socket aborted');
                    reject('socket aborted');
                })
                .on('timeout', function () {
                    console.log('socket timeout');
                    reject('socket timeout');
                })
                .on('error', function (err) {
                    console.log(err);
                    reject(err);
                })
                .on('response', function (resp) {
                    if (resp.headers['content-disposition'] === undefined) {
                        return reject(new Error('missing content-disposition'));
                    }
                    fname = resp.headers['content-disposition'].split(';')[1].replace(' filename=', '');
                    state.size.total += parseInt(resp.headers['content-length']);
                    dest = path.join(wpath, fname);
                    resp.pipe(file);
                })
                .on('data', function (data) {
                    state.size.transferred += data.length;
                    let a = (state.size.transferred / 1048576).toFixed(2);
                    let b = (state.size.total / 1048576).toFixed(2);

                    process.stdout.write(`downloading ${fname} ${a}/${b} MB\r`);
                })
                .on('end', function () {
                    process.stdout.write('\n');
                    file.end();
                    fs.renameSync(tmp, dest);
                    fulfill(dest);
                });
        }
        catch(err){
            reject(err);
        }
    });
}

function get(url){
    return call( url, 'GET', null, null, 'application/json' );
}

function post(url, data, type, accept){
    return call( url, 'POST', data, type, accept );
}


function call(url, method, data, type, accept){

    return new Promise( ( fulfill, reject ) => {

        let options = {
            url  : 'https://www.save.tv' + url,
            method : method,
            encoding : null,
            headers : {
                'accept' : accept || 'text/html',
                'User-Agent' : 'Mozilla/5.0'
            },
            timeout : 90000,
            agent : keepAliveAgent.https,
            followRedirect: false
        };

        if ( data === undefined )
            data = null;

        if ( data !== null ){
            if ( type === 'application/json' )
                data = JSON.stringify(data);

            options['body'] = data;
            options['headers']['content-type'] = type;
        }

        request(options, (err, response, body) => {

            //console.log(body.toString('utf8'));
            if ( err ) {
                reject(err);
                return;
            }

            if ( response.statusCode === 401 ){
                reject(err);
                return;
            }

            fulfill( body );
        });
    });
}


function processArchive( complete, entry, i ){

	console.log('processing recording => ' + entry.ITELECASTID );

    entry.ARRALLOWDDOWNLOADFORMATS.forEach(function (format) {
        if (format.SNAME === 'H.264 SD' && !entry.IRECORDINGFORMATID)
            entry.IRECORDINGFORMATID = format.RECORDINGFORMATID;

        if (format.SNAME === 'H.264 HD')
            entry.IRECORDINGFORMATID = format.RECORDINGFORMATID;
    });

    get('/STV/M/obj/cRecordOrder/croGetDownloadUrl2.cfm?TelecastId=' + entry.ITELECASTID + '&iFormat=' + entry.IRECORDINGFORMATID + '&bAdFree=false', 'application/json')
        .then((data) => {
            let recordingData = JSON.parse(data);

            if (recordingData.SUCCESS) {
                let dlUrl = recordingData.DOWNLOADURL;

                download(entry.ITELECASTID, dlUrl)
                    .then ( (dest) => {
                        fs.writeJson(dest + '.meta', entry);
                        db.insert(entry, function (err, newDoc) {
                            console.log('marked recording => ' + entry.ITELECASTID + ', complete');
                            complete();
                        });
                    })
                    .catch( (err) =>{
                        console.log('error downloading recording => ' + entry.ITELECASTID );
                        console.log(err);
                        complete();
                    })
            }
        });
}

function processList( entries ){

	return new Promise( ( fulfill, reject) => {
        let processList = [];

	    try {
            function searchDatabase(complete, entry, i) {
                if (entry.STRTELECASTENTRY !== undefined)
                    entry = entry.STRTELECASTENTRY;

                //set our primary key for the db
                entry['_id'] = entry.ITELECASTID;

                // Finding all shows with the same id
                db.find({_id: entry['_id']}, function (err, docs) {
                    // nothing found
                    if (docs.length == 0) {
                        console.log('adding new recording => ' + entry.ITELECASTID + ', title => ' + entry.STITLE);
                        processList.push(entry);
                    }
                    complete();
                });
            }

            forAllAsync(entries, searchDatabase, 10).then(function () {
                forAllAsync(processList, processArchive, maxCallsAtOnce).then(function () {
                    fulfill();
                });
            });
        } catch( err ){
           reject(err);
        }

    });
}


function loadList(){

    return new Promise( (fulfill, reject) =>{

        let entries = [];

        function loadListPage( pgNum ){

            return new Promise( (fulfill, reject) =>{

                let startDate = new Date( (new Date()).setDate( (new Date()).getDate() - 30 ) ).toISOString().slice(0,10);
                let endDate = new Date().toISOString().slice(0,10);

                get( '/STV/M/obj/archive/JSON/VideoArchiveApi.cfm?iEntriesPerPage=10&iCurrentPage=' + pgNum + '&dStartdate=' + startDate + '&dEnddate=' + endDate )
                    .then( ( data ) => {
                        data = JSON.parse(data);
                        entries = entries.concat(data.ARRVIDEOARCHIVEENTRIES);
                        if ( data.ICURRENTPAGE < data.ITOTALPAGES ){
                            loadListPage( pgNum + 1 )
                                .then( () =>{
                                    fulfill(entries);
                                });
                        } else {
                            fulfill(entries);
                        }
                    })
                    .catch( (err) =>{
                       reject(err);
                    });
            });
        }

        loadListPage(1)
        .then( (entries) => {
            fulfill( entries );
        })
        .catch( (err) => {
            reject(err);
        })
    });
}

function logout(){
	get( '/STV/M/obj/user/usLogout.cfm' );
}

function run( user, password ){
	post( '/STV/M/Index.cfm?sk=PREMIUM', 'sUsername=' + user + '&sPassword=' + password + '&value=Login', ' application/x-www-form-urlencoded' )
        .then( () => {
            return loadList();
        })
        .then( (entries) =>{
            return processList(entries);
        })
        .then( () => {
            logout();
        });
}

process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    process.exit(1);
});

run( ops.user, ops.password );
