
const {
   
    ObjectsApi,
    
} = require('forge-apis');

// Enable colourful console logging
const colors = require('colors')
colors.enable()


const { v1: uuidv1 } = require('uuid'); // time based uuid
// uuidv1(); // -> '6c84fb90-12c4-11e1-840d-7b25c5ee775a' 







const fs = require('fs');
const DecompressZip = require('decompress-zip');
const request = require("request-promise")

const request_promise_native = require("request-promise-native")
const request_normal = require("request")
const Airtable = require("airtable")

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = "appht0tyYgv6ZxVvU" // EMEA BIM 360 TRANSFER - https://airtable.com/tblyIl5LhMAB7IfZH/viweBNuOdmcYYmsRG?blocks=hide

Airtable.configure({
    endpointUrl: "https://api.airtable.com",
    apiKey: AIRTABLE_API_KEY
  });

const base = new Airtable.base(AIRTABLE_BASE_ID);

const TABLE_NAME = "DOCS - CONTENTS"

const table = base.table(TABLE_NAME)




/**
 * Deleate any zip files previously downloaded, and the corresponding extracted rvt file.
 * This is to prevent conflicts on the local node file system, where files are downloaded and extracted before uploading
 * 
 * @param {String} path The file path of the download in the local node file system
 */
const cleanupPreviousDownload = (path) => {
    // remove download destination file if already downloaded

    const paths = [
        path,
        path.replace('zip', 'rvt')
    ]

    paths.forEach(path => {

        try {
            if (fs.existsSync(path)) {
                //file exists
                fs.unlinkSync(path)
                //file removed
                console.log(`Removed:  ${path}`)
              }
        } catch(err) {
            console.error(err)
        }
    })

}


transferFile =  (source, destination, token) => {
    
    const reqOptions = {
        uri: source,
        url: source,
        // omit headers when retrieving a file from AWS without requiring authentication
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        }
    }

    const sendReq = request_normal.get(reqOptions);
    
    return new Promise((resolve, reject) => {
        sendReq
            .on('response', (resSource) => {
                // console.log('Download ' + source.url + ': ' + resSource.statusCode + ' > ' + resSource.statusMessage);
                resSource.headers['content-type'] = undefined;
                if (resSource.statusCode != 206 && resSource.statusCode != 200) {
                    resolve(resSource)
                }
            })
            .pipe(request_normal(destination)
                .on('response', (resDestination) => {
                    // console.log('Upload ' + destination.url + ': ' + resDestination.statusCode + ' > ' + resDestination.statusMessage);
                    resolve(resDestination)
                }))
    })
}



/**
 * Download file from url to local file system, in preparation for re-uploading to the target
 * 
 * @param {String} url Url of file to download
 * @param {String} dest file path of local folder to store downloaded files
 * @param {Object} token authentication token from the client request
 * @param {Function} extractFilesCallback extractFiles callback function to unip the zip file once downloaded
 * @param {Object} req the request object from the client
 * @param {Object} res the response object to be sent back to the client
 * @param {Boolean} extract set to false to prevent the unzip operation
 */
const download = (url, dest, token, extractFilesCallback, req, res, extract=true) => {
    // remove download destination file if already downloaded
    cleanupPreviousDownload(dest)

    const file = fs.createWriteStream(dest);
    // console.log('req (in "download" method): ', req)

    console.log('Attempting download of: '.magenta.bold, url.yellow)
    updateAirtable(req, 'Unzip Status', 'Downloading...')

    //transferFile(url, file, token)

    const reqOptions = {
        url: url,
        // omit headers when retrieving a file from AWS without requiring authentication
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        }
    }

    const sendReq = request_normal.get(reqOptions);

    // verify response code
    sendReq.on('response', (response) => {
        if (response.statusCode !== 200) {
            console.log("response status " + response.statusCode)
            // return cb('Response status was ' + response.statusCode);
            return
        }

        sendReq.pipe(file);
    });

    // close() is async, call extractFilesCallback after close completes
    if (extract){
        file.on('finish', () => file.close(extractFilesCallback(req)));
        
    }else{
        file.on('finish', () => file.close( () => {
            console.log('Finished...')
        }));
    }

    // check for request errors
    // sendReq.on('error', (err) => {
    //     fs.unlink(dest);
    //     console.log(err.message)
    //     return err.message;
    // });

    file.on('error', (err) => { // Handle errors
        console.log(err.message)
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return err.message;
    });
};


/**
 * Find the 'host' .rvt file in the .zip by matching the file names.
 * 
 * @param {Array} extractLogList The extract file log containing file names unzipped from the archive
 * @param {String} fileName The filename of the zip file we are unzipping
 */
const findFileByName = (extractLogList, fileName) => {
    console.log('in findFileByName')
    console.log('Searching for '.magenta, fileName.replace('.zip', '.rvt').yellow)
    // NOTE - this assumes the zip file is named the same as the 'host' rvt in the contents of the zip.. 
    let fileNameResult
    extractLogList.forEach(log => {
        
        if (log.deflated.includes(fileName.replace('.zip', ''))) {
            console.log('filename:', log)
            fileNameResult = log.deflated
            return
        }
    })

    return fileNameResult

}

/**
 * Unzip file. 
 * 
 * @param {String} file File path to zip archive in local file system
 * @param {Function} uploadCallback Callback function to upload the unzipped file
 * @param {Object} req Request object - containing details of file to unzip 
 * @param {Object} res Response object - to send back status message to client
 */
const unzip = (file, uploadCallback, req, res) => {

    let unzipper = new DecompressZip( file);
    let extractFilePath = 'routes/data'
    unzipper.extract({
        path: extractFilePath
    })

    updateAirtable(req, 'Unzip Status', 'Unzipping file...')
    // gets stuck here?
    unzipper.on('extract', function (log) {
        console.log('Extacting file: '.magenta, file.yellow)
        console.log('extract log ', log);
        console.log('file name in request'.cyan, req.body.fileItemName.yellow.bold)
        // const unzippedFileToUpload = extractFilePath +'/'+ log[0].deflated
        const unzippedFileToUpload = extractFilePath +'/'+ findFileByName(log, req.body.fileItemName)
        // uploadCallback(unzippedFileToUpload, req)

        createStorageForFile(unzippedFileToUpload, req, res, uploadCallback)

        // send the (first) file extracted as a download to the client (not working yet)
        //res.download(extractFilePath +'/'+ log[0].deflated).end("unzip endpoint called");
        res.status(200).end(inputUrl);
    });
}

/**
 * Creates a storage based on a specific file
 * 
 * @param {String} file File name of the file to be uploaded to storage
 * @param {Object} req Request object from the client
 * @param {Object} res Response object to be sent to the client
 * @param {Function} uploadCallback Callback function to upload the file once storage has been created
 */
const createStorageForFile = async (file, req, res, uploadCallback) => {
    const dataFolder = 'routes/data'
    const filePath = dataFolder+'/'+file
    const storage = await createStorage(req, res, filePath)
    // console.log('storageResult'.magenta, JSON.stringify(storage, null, "----"))
    req.storageId = storage.data.id
    console.log(`Storage created for ${file}`.brightGreen.bold, storage.data.id.yellow)
    updateAirtable(req, 'Unzip Status', 'Creating storage...')
    uploadCallback(file, req)
}


/**
 * Extract files. This is the main function that calls other operations. 
 * 
 * 'extractFiles' calls the 'unzip' function.
 * 'unzip' calls 'createStorageForFile' (which calls 'createStorage') for the unzipped file
 * once unzip operation is complete, 'unzip' calls the 'uploadUnzippedFile' as a callback
 * 'uploadUnzippedFile' calls 'uploadFile' - which uploads the file to the created storage
 * on successful upload, 'uploadFile' calls 'createVersion' to create a new version from the uploaded unzipped file
 * 
 * phew! that was a lot to explain... 
 * 
 * @param {Object} req - the request sent from the client
 * @param {Object} res - the response sent back to the client
 */
const extractFiles =  (req, res) => {

    const dataFolder = 'routes/data'
    console.log('Files in local file system: '.cyan)

    fs.readdir(dataFolder, (err, files) => {
        // list all files currently in the local working folder
        files.forEach( file => {

            let f = file
            let filePath = dataFolder+'/'+f
            let stats = fs.statSync(filePath)
            let sizeInBytes = stats["size"]
            let sizeInMB = sizeInBytes/1000000

            console.log(`${file} : ${sizeInMB}MB`.yellow);
        });  

        // search for the requested file
        console.log('in extractFiles function')
        console.log('current requested file', req.body.fileItemName )
        let filePathToUnzip
        files.forEach( file => {
            
            let filePath = dataFolder+'/'+file
            
            console.log('current file', filePath )
            if (filePath.includes(".zip") && filePath.includes(req.body.fileItemName) ) {
                
                
                filePathToUnzip = filePath
                return
            }
            
        })
        console.log(`Unzipping ${filePathToUnzip}`.magenta.bold )
        unzip(filePathToUnzip, uploadUnzippedFile, req, res)



    });
}


/**
 * Better verion of create storage
 * @param {Object} req The request object
 * @param {String} fileName The name of the unzipped file
 * 
 * see https://stackoverflow.com/questions/50109167/autodesk-forge-api-uploading-file-fails
 */
const betterCreateStorage = async (req, fileName) => {
    // console.log('In betterCreateStorage...')
    const projectId = req.body.project_id
    const folder = req.folder
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/storage`

    const x_user_id = ''
    const token = req.body.oauth_token
    const headers = {
        // "x-user-id": x_user_id, 
        "Content-Type": "application/vnd.api+json", 
        "Authorization": `Bearer ${token}`
    }
    const name = fileName // req.body.fileItemName
    const hostType = 'folders'
    const hostId = folder.body.data.id
    const data = {
        "jsonapi": {"version": "1.0"},
        "data": {
            "type": "objects",
            "attributes": {
                "name": name,
                "extension": {
                    "type": "versions:autodesk.bim360:File",
                        "version": "1.0"
                    }
            
            },
            "relationships": {
                "target": {"data": {"type": hostType, "id": hostId}}
            },
        },
    }

    const requestParams = {
        headers: headers,
        uri: url,
        method: 'POST',
        body: data,
        json: true,
    }

    console.log('Ready to create storage...'.cyan)
    const storageResult = await request(requestParams, function (error, response, body) {
        if (error) {
            console.log(`Error: ${error}`.red)
        }
        
        // console.log('Storage info (body)...'.cyan)
        // console.log('body: ', JSON.stringify(body, null, '----'))
        console.log('Storage created... '.cyan)

        const storageId = body.data.id
        const objectName = storageId.split('/')[1]

        req.objectName = objectName
        req.storageId = storageId


    })
    
    return storageResult
    
}


/**
 * Create version from unzipped file.
 * 
 * @param {String} projectId The itemId sent in the original api request
 * @param {String} itemId The itemId sent in the original api request
 * @param {String} storageId The storageId of the storage object created to host the unzipped file
 * @param {String} fileName The itemId sent in the original api request
 * 
 */
const createVersion = async (req) => {

    const projectId = req.body.project_id
    

    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/versions`

    const token = req.body.oauth_token
    const headers = {
        // "x-user-id": x_user_id, 
        "Content-Type": "application/vnd.api+json", 
        "Authorization": `Bearer ${token}`
    }

    const data = {
        "jsonapi": {"version": "1.0"},
        "data": {
            "type": "versions",
            "attributes": {
                "name": req.body.fileItemName.replace('.zip', '.rvt'),
                "extension": {
                    "version": "1.0",
                    "type": "versions:autodesk.bim360:File",
                },
            
            },
            "relationships": {
                "item": {"data": {"type": "items", "id": req.body.item_id}},
                "storage": {
                    "data": {"type": "objects", "id": req.storageId}
                },
            },
        },
    }

    console.log(
        'Create Version Data'.cyan, 
        JSON.stringify(data, null, "----")
        )

    const requestParams = {
        headers: headers,
        uri: url,
        method: 'POST',
        body: data,
        json: true,
    }

    console.log('Ready to create version...'.cyan)
    updateAirtable(req, 'Unzip Status', 'Creating version...')
    const versionResult = await request(requestParams, function (error, response, body) {
        if (error) {
            console.log(`Error: ${error}`.red)
        }
        if (body.errors) {
            updateAirtable(req, "Unzip Status", `Error creating version`)
            updateAirtable(req, "Unzip Info", `${body.errors[0].detail}`) // first error only (!)
            console.log(`Errors:`.red, JSON.stringify(body.errors, null, '----') )
            return 
        }
        
        console.log('Version info (body)...'.cyan)
        console.log('body: ', JSON.stringify(body, null, '----'))
        console.log('Version created... '.cyan.bold, body.data.id.yellow)
        updateAirtable(req, 'Unzip Status', 'Complete')
        

    })
    
    return versionResult


}
/**
 * Update the airtable record for the file being processed with current progress
 * @param {Object} req Request object from the client, which contains the airtable_record_id for the file
 * @param {String} fieldName The Airtable field name to update
 * @param {String} message The message / status to set in the field value.
 */
const updateAirtable = (req, fieldName, message) => {
    const recordId = req.body.airtable_record_id
    console.log(
        'Updating airtable - record '.magenta, 
        recordId.yellow, 
        'Status:',
        message.yellow.bold
        
        )
    const data = {

    }
    data[fieldName] = message

    table.update(recordId, data).then(result=>{
        console.log('Airtable updated!'.green)
        // console.log(result)
    }).catch(err => {
        console.log('Airtable error: '.red, err)
    })

}



/**
 * Unpack file data from the request. Returns resourceId and projectId
 * 
 * @param {Object} req request object, containing incoming project_id and fileItemId
 * @param {Object} res response
 */
const unpackFileData = (req, res, fileItemName) => {

    const projectId = req.body.project_id
    const fileItemId   = req.body.fileItemId;
    if (!fileItemName){
        fileItemName = req.body.fileItemName
    }

    if (fileItemId === '' || fileItemName === '') {
        res.status(500).end();
        return;
    }

    if (fileItemId === '#') {
        res.status(500).end('not supported item');
    } 

    const params = fileItemId.split('/');
    if( params.length < 3){
        res.status(500).end('selected item id has problem');
    }

    const resourceName = params[params.length - 2];
    if (resourceName !== 'items') {
        res.status(500).end('not supported item');
        return;
    }

    const resourceId = params[params.length - 1];
    // if no projectId in request, try to extract it from the fileItemId
    if (!projectId){
        const projectId = params[params.length - 3];
    }

    return {
        "resourceId" : resourceId,
        "projectId" : projectId
    }    

}

/**
 * Create storage object in bucket to receive file uploaded bytes.
 * 
 * @param {Object} req request object from the client
 * @param {Object} res response object to the client
 * @param {String} unzippedFilePath path to unzipped file in local file system
 */
const createStorage = async (req, res, unzippedFilePath) => {
    
    const projectId = req.body.project_id
    const filePathParts = unzippedFilePath.split('/')
    const fileName = filePathParts[filePathParts.length-1]
    const fileItemName = fileName;
    
    const resourceId = unpackFileData(req, res, fileItemName).resourceId

    console.log(`Creating storage for ${fileName}... `.magenta.bold)
    console.log(`resourceId:`, `${resourceId}`.yellow)
    console.log(`projectId:`,`${projectId}`.yellow)

    const storageResult = await betterCreateStorage(req, fileName )

    return storageResult
}


/////////////////////////////////////////////////////////
// Uploads object to bucket using resumable endpoint
//
/////////////////////////////////////////////////////////
const uploadObjectChunked = (token, bucketKey, objectKey,
    file, opts = {}) => {

    return new Promise((resolve, reject) => {

        const chunkSize = opts.chunkSize || 5 * 1024 * 1024

        const nbChunks = Math.ceil(file.size / chunkSize)

        const chunksMap = Array.from({
            length: nbChunks
        }, (e, i) => i)

        // generates uniques session ID
        const sessionId = uuidv1()  // time based uuid

        // prepare the upload tasks
        const uploadTasks = chunksMap.map((chunkIdx) => {

            const start = chunkIdx * chunkSize

            const end = Math.min(
                file.size, (chunkIdx + 1) * chunkSize) - 1

            const range = `bytes ${start}-${end}/${file.size}`
            console.log(range)
            const length = end - start + 1

            const readStream =
                fs.createReadStream(file.path, {
                    start,
                    end
                })

            const run = async () => {

                // const token = await getToken()

                return this._objectsAPI.uploadChunk(
                    bucketKey, objectKey,
                    length, range, sessionId,
                    readStream, {}, {
                        autoRefresh: false
                    }, token)
            }

            return {
                chunkIndex: chunkIdx,
                run
            }
        })

        let progress = 0

        // runs asynchronously in parallel the upload tasks
        // number of simultaneous uploads is defined by
        // opts.concurrentUploads
        const eachLimit = (uploadTasks, opts.concurrentUploads || 3,
            (task, callback) => {

                task.run().then((res) => {

                    if (opts.onProgress) {

                        progress += 100.0 / nbChunks

                        opts.onProgress({
                            progress: Math.round(progress * 100) / 100,
                            chunkIndex: task.chunkIndex
                        })
                    }

                    callback()

                }, (err) => {

                    console.log('error')
                    console.log(err)

                    callback(err)
                })

            }, (err) => {

                if (err) {

                    return reject(err)
                }

                return resolve({
                    fileSize: file.size,
                    bucketKey,
                    objectKey,
                    nbChunks
                })
            })
    })
}


myUploadChunk = async (req, data) => {

    const {
        bucketKey ,
        fileName,
        filePath,
        objectName ,
        storageId,
        hostId,
        contentLength ,
        body,
        folderId,
        options,
        oauth2client,
        credentials 
        
    } = data
   
   
    const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectName}/resumable`;

    // bucketKey,
    //         objectName,
    //         contentLength,
    //         contentRange,
    //         sessionId,
    //         readStream, // body.slice(start, end),
    //         {},
    //         oauth2client,
    //         credentials

    const token = req.body.oauth_token
    
    const headers = {
                'Authorization':'Bearer ' + token,
                'Content-Type':'application/octet-stream',
                'Content-Range': contentRange,
                'Session-Id': session
            }

    const requestParams = {
        headers: headers,
        uri: url,
        url: url,
        method: 'put',
        body: body.slice(start, end),
        json: true,
    }

    console.log('Ready to upload chunk...'.cyan)

    const reqOptions = {
        url: url,
        // omit headers when retrieving a file from AWS without requiring authentication
        headers: headers
    }

    const uploadChunkReq = request_normal.put(reqOptions);

    // verify response code
    uploadChunkReq.on('response', (response) => {
        console.log(JSON.stringify(response, null, "----"))
        if (response.statusCode !== 200) {
            console.log("response status " + response.statusCode)
            // return cb('Response status was ' + response.statusCode);
            return
        }

        
    });


    // const uploadResult = await request(requestParams, function (error, response, body) {
    //     if (error) {
    //         console.log(`Error: ${error}`.red)
    //     }
    //     if (body.errors) {
    //         updateAirtable(req, "Unzip Status", `Error uploading`)
    //         updateAirtable(req, "Unzip Info", `${body.errors[0].detail}`) // first error only (!)
    //         console.log(`Errors:`.red, JSON.stringify(body.errors, null, '----') )
    //         return 
    //     }
        
    //     console.log('Chunk upload info (body)...'.cyan)
    //     console.log('body: ', JSON.stringify(body, null, '----'))
    //     console.log('Chubk Uploaded... '.cyan.bold, body.data.id.yellow)
    //     updateAirtable(req, 'Unzip Status', 'Complete')
        

    // })



}

const wait = ms => new Promise((r, j)=>setTimeout(r, ms))

const promiseRequest = (params) => {
    return new Promise(resolve => {
        return request_normal(params, (error, response, body) => {
            // console.log("response", response)
            console.error('error:', error); // Print the error if one occurred
            console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
            console.log('body:', body); // Print the HTML for the Google homepage.
            resolve(body)
        })
    }, reject => {
        console.log("rejected", error)
        reject(error)
    })

}

/**
 * Upload a file to the storage object, and create a new version in the stack.
 * @param {Object} req The request sent to the API endpoint (needed for createVersion)
 * @param {Object} data Object containing data prepared by the caller function uploadUnzippedFile
 */
const uploadFile = async (req, data) => {

    const objects = new ObjectsApi()
    
    const {
        bucketKey ,
        fileName,
        filePath,
        objectName ,
        storageId,
        hostId,
        contentLength ,
        body,
        fileBuffer,
        folderId,
        options,
        oauth2client,
        credentials 
        
    } = data
    
    console.log(
        `Uploading file:`.magenta.bold , 
        fileName.yellow,  
        `to storage:`.magenta.bold,  
        objectName.yellow
        )
    console.log(
        `Destination folder:`.magenta.bold, 
        folderId.yellow
        )

    // const singleUploadPromise = objects.uploadObject(
    //     bucketKey,
    //     objectName,
    //     contentLength,
    //     body,
    //     options,
    //     oauth2client,
    //     credentials

    // )


    // resumable upload

    // https://forge.autodesk.com/blog/nailing-large-files-uploads-forge-resumable-api

    // const opts = {}

    // const response = await uploadObjectChunked(
    //     credentials,
    //     bucketKey,
    //     objectName,
    //     body,
    //     opts
    // )

    // console.log('uploadChunk response', response.body)

    // const version =  await createVersion(req)
    // console.log('Version created'.green.bold)

    /// First attempt

    let sessionId = Math.floor(100000000 + Math.random() * -900000000);

    const token = req.body.oauth_token

    let promises = []
    const chunkSize = 4999999 // 5MB in bytes
    let start = 0
    let end = start + chunkSize
    console.log("Chunk upload...")
    let chunkCount = 1
    let totalChunks = Math.ceil(chunkSize/contentLength)
    while (end < contentLength-1){
        end = start + chunkSize - 1

        
        
        if ( end > contentLength-1){
            end = contentLength-1
        }

        let contentRange = `bytes ${start}-${end}/${contentLength}`
        console.log('contentRange', contentRange)


        let readStream = fs.createReadStream(filePath, {start, end})

        const headers = {
            'Authorization':'Bearer ' + token,
            'Content-Type':'application/octet-stream',
            'Content-Range': `${contentRange}`,
            'Content-Length': `${contentLength}`,
            'Session-Id': `${sessionId}`,
            //'User-Agent': 'Request-Promise'
        }

        const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectName}/resumable`;

        

        const requestParams = {
            headers: headers,
            uri: url,
            url: url,
            method: 'PUT',

            body:  fileBuffer.slice(start, end), // body.slice(start, end), // readStream, //
            // json: true, // automatically parses the json string in the response
            resolveWithFullResponse: true    //  <---  <---  <---  <---
            
        }

        console.log('requestParams', JSON.stringify(requestParams))

        
        console.log('Ready to upload chunk...'.cyan)

        

        // const uploadChunkPromise = promiseRequest(requestParams)
        const delayMs = 1000
        console.log(`simulating waiting for ${delayMs} milliseconds `)
        // same thing, using await syntax
        await wait(delayMs)
        console.warn('done waiting')

        // request option 1 - 

        // request_promise_native(requestParams)
        //     .then(response => {
        //         console.log('in the THEN - success', response.statusCode, response.statusMessage)
        //         // console.log(response)
        //     })
        //     .catch(error => {
        //         console.log('in the THEN - Error', error)
        //     })

       // request option 2 -

        const uploadChunkPromise =  new Promise((resolve, reject) => {
                request_normal(requestParams, (err, res, body)=> {
                    console.log('err: ', err)
                    console.log('res: ', JSON.stringify(res, null, '----'))
                    console.log('body: ', body)

                } )  
                    .on('response', (resUpload) => {
                        console.log('Uploading '  + resUpload.statusCode + ' > ' + resUpload.statusMessage);
                        resUpload.headers['content-type'] = undefined;
                        if (resUpload.statusCode != 206 && resUpload.statusCode != 200) {
                            resolve(resUpload)
                        }
                    })
                   
            })
        

        // verify response code
        // uploadChunkReq.on('response', (response) => {
        //     console.log(JSON.stringify(response, null, "----"))
        //     if (response.statusCode !== 200) {
        //         console.log("response status " + response.statusCode)
        //         // return cb('Response status was ' + response.statusCode);
        //         return
        //     }

            
        // });

        // const uploadResult = await request(requestParams, function (error, response, body) {
        //     if (error) {
        //         console.log(`Error: ${error}`.red)
        //     }
        //     if (body.errors) {
        //         updateAirtable(req, "Unzip Status", `Error uploading`)
        //         updateAirtable(req, "Unzip Info", `${body.errors[0].detail}`) // first error only (!)
        //         console.log(`Errors:`.red, JSON.stringify(body.errors, null, '----') )
        //         return 
        //     }
            
        //     console.log('Chunk upload info (body)...'.cyan)
        //     console.log('response: ', JSON.stringify(response, null, '----'))
        //     let chunkProgressMessage = `Chunk ${chunkCount} of ${totalChunks} uploaded... `
            
        //     console.log(chunkProgressMessage.cyan.bold, body.data.id.yellow)
        //     updateAirtable(req, 'Unzip Status', chunkProgressMessage)
        // })

        // console.log( 'uploadResult', uploadResult )

        
        // let chunkUploadPromise = objects.uploadChunk(
        //     bucketKey,
        //     objectName,
        //     contentLength,
        //     contentRange,
        //     sessionId,
        //     readStream, // body.slice(start, end),
        //     {},
        //     oauth2client,
        //     credentials
        //     )
        //     console.log('chunkUploadPromise', chunkUploadPromise)

        //     // chunkUploadPromise.then((result) => {
        //     //     console.log('chunkUploadPromise - resolved', result)
        //     // }, (result) => {
        //     //     console.log('chunkUploadPromise - rejected', result)
        //     // })

              //  promises.push(uploadChunkPromise) 
            
            if (end < contentLength){
                start += chunkSize
            }
        }
    
    // console.log('promises', promises)

    // const chunksUploadPromises = await Promise.all(promises)   

    // console.log('chunksUploadPromises', chunksUploadPromises)
    
    // let uploadPromise = chunksUploadPromises // singleUploadPromise

    // // // uploadPromise = promises[0]

    // uploadPromise.then( async (result) => {
    //     console.log('Upload promise resolved'.brightGreen.bold)
    //     console.log(JSON.stringify(result, null, "----"))

    //     const version =  await createVersion(req)
    //     console.log('Version created'.green.bold)
    //     // console.log(JSON.stringify(version, null, "----"))
    // }, function(result){
    //     console.log("Upload promise rejected".red.bold)
    //     console.log(JSON.stringify(result, null, "----"))
    // })

}

/**
 * Upload Unzipped File. 
 * Callback function to upload the unzipped file to the bucket storage, 
 * once the unzip operation has completed
 * @param {String} unzippedFilePath path of file once unzipped in local filesystem
 * @param {Object} req the request object (with authentication info) from the API call from the python upgrade/unzip script
 * 
 */
const uploadUnzippedFile = (  ( unzippedFilePath, req, hostId) => {

    const credentials = {
        // with Bearer we get the error:faultstring: 'Failed to Decode Token: policy(jwt-decode-HS256)',
        "access_token": req.body.oauth_token, 
        "expires_in" : 3600
    }

    console.log(`Ready to upload ${unzippedFilePath}...`)
    updateAirtable(req, 'Unzip Status', 'Uploading...')
    // console.log("req", req.body)
    // Store file data chunks in this array
    let chunks = [];
    // Read file into stream.Readable
    let fileStream = fs.createReadStream(unzippedFilePath);
    fileStream.on('open', () => {
        console.log('Stream opened...');
    });

    fileStream.on('data', chunk => {
        
        chunks.push(chunk)
    });
    
    // An error occurred with the stream
    fileStream.once('error', (err) => {
        // Be sure to handle this properly!
        console.log("Error reading fileStream...")
        console.error(err); 
    });

    // File is done being read
    fileStream.once('end', () => {
        // create the final data Buffer from data chunks;
        fileBuffer = Buffer.concat(chunks);

        console.log('fileBuffer', fileBuffer)
        
        const filePathParts = unzippedFilePath.split('/')
        const fileName = filePathParts[filePathParts.length-1]
        const contentLength = fileBuffer.length // file size in bytes?

        console.log('content-length', contentLength )

        const data = {
            bucketKey: "wip.dm.prod",
            fileName: fileName,
            folderId: req.folder.body.data.id,
            filePath: unzippedFilePath,
            objectName: req.objectName,
            storageId: req.storageId,
            hostId: hostId,
            contentLength:  contentLength,
            body: fileBuffer, 
            fileBuffer: fileBuffer,
            options: {
                access: "readwrite"
            },
            oauth2client: req.oauth2_client, 
            credentials: credentials
    
        }
        return uploadFile(req, data)
    });

})


module.exports = {
    download,
    extractFiles
}