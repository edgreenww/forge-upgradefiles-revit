/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

const express = require('express');

const {
    ItemsApi,
    VersionsApi,
    ObjectsApi
} = require('forge-apis');

const { OAuth } = require('./common/oauthImp');

const { 
    getWorkitemStatus, 
    cancelWorkitem,
    upgradeFile, 
    getLatestVersionInfo, 
    getNewCreatedStorageInfo, 
    createBodyOfPostVersion,
    createBodyOfPostItem,
    workitemList 
} = require('./common/da4revitImp')

const SOCKET_TOPIC_WORKITEM = 'Workitem-Notification';

let router = express.Router();





///////////////////////////////////////////////////////////////////////
/// Middleware for obtaining a token for each request.
///////////////////////////////////////////////////////////////////////
router.use(async (req, res, next) => {
    const oauth = new OAuth(req.session);
    let credentials = await oauth.getInternalToken();

    let oauth_client = oauth.getClient();

    let incomingCreds = {
        "client_id" : req.body.client_id,
        "client_secret" : req.body.client_secret,

    }
    console.log('credentials', credentials)
    if (incomingCreds.client_id){
        console.log("Using incomeing credentials...")
        credentials = incomingCreds
    }
    // let oauth_client2 = oauth.getClientOurWay(req.scopes, incomingCreds);
    console.log('oauth_client', oauth_client)
    req.oauth_client = oauth_client;
    req.oauth_token = credentials;
    next();
});

///////////////////////////////////////////////////////////////////////
/// NEW ROUTE - unzip zip file from CompositeDesign
///////////////////////////////////////////////////////////////////////

const fs = require('fs');
const zlib = require('zlib');
const DecompressZip = require('decompress-zip');
const request = require("request")

const download = (url, dest, token, extractFilesCallback, req, extract=true) => {
    const file = fs.createWriteStream(dest);
    // console.log('req (in "download" method): ', req)

    console.log('Attempting download of: ', url)

    const reqOptions = {
        url: url,
        // omit headers when retrieving a file from AWS without requiring authentication
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        }
    }

    console.log("reqOptions", reqOptions)

    const sendReq = request.get(reqOptions);

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
    sendReq.on('error', (err) => {
        fs.unlink(dest);
        console.log(err.message)
        return err.message;
    });

    file.on('error', (err) => { // Handle errors
        console.log(err.message)
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return err.message;
    });
};

const unzip = (file, uploadCallback, req) => {

    let unzipper = new DecompressZip( file);
    let extractFilePath = 'routes/data'
    unzipper.extract({
        path: extractFilePath
    })
    // console.log('req from "unzip"', req.body)
    
    unzipper.on('extract', function (log) {
        console.log('extract log ', log);
        const unzippedFileToUpload = extractFilePath +'/'+ log[0].deflated
        // uploadCallback(unzippedFileToUpload, req)

        createStorageForFile(unzippedFileToUpload, req, uploadCallback)

        // send the (first) file extracted as a download to the client (not working yet)
        //res.download(extractFilePath +'/'+ log[0].deflated).end("unzip endpoint called");
        res.status(200).end(inputUrl);
    });
}

const createStorageForFile = async (file, req, uploadCallback) => {
    const dataFolder = 'routes/data'
    let filePath = dataFolder+'/'+file
    
    console.log('Creating storage for ' + filePath )
    // console.log('Creating storage...')
    const storageId = await createStorage(req, filePath)

    
    const objectName = storageId.split('/')[1]

    req.objectName = objectName

    

    
    console.log('Storage created for ' + filePath)
    uploadCallback(file, req)
}

// const createStorageForEachFile = async (files, req) => {
//     const promises = files.map(createStorageForFile)
//     await Promise.all(promises)
//     console.log('All storages created!')

// }

const createStorageForEachFile = async (files, req) => {
    const allAsyncResults = []
  
    for (const file of files) {
      const asyncResult = await createStorageForFile(file, req)
      allAsyncResults.push(asyncResult)
    }
    console.log('All storages created!')
    return allAsyncResults
  }

const extractFiles =  (req) => {

    const dataFolder = 'routes/data'
    console.log('Files in local file system: ')

    // console.log('req from "extractFiles"', req.body)
    console.log('reading directory... (before fs.readdir)')
    fs.readdir(dataFolder, (err, files) => {
        console.log('reading directory... (inside fs.readdir)')
        files.forEach( file => {

            let f = file
            let filePath = dataFolder+'/'+f
            let stats = fs.statSync(filePath)
            let sizeInBytes = stats["size"]
            let sizeInMB = sizeInBytes/1000000

            console.log(file, sizeInMB+"MB");
        });  

        // console.log('req from "fs.readdir"', req.body)
        // createStorages promise

        //  createStorageForEachFile(files, req)

        
        
        files.forEach( file => {
            
            let filePath = dataFolder+'/'+file
            if (filePath.includes(".zip")){
                console.log('Unzipping ' + filePath )
                // console.log('Creating storage...')
                
    
                // createStorage(req, filePath, unzip)
                unzip(filePath, uploadUnzippedFile, req)
            }

        })

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
    console.log('In betterCreateStorage...')
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

    console.log('Ready to create storage...')
    const storageResult = await request(requestParams, function (error, response, body) {
        console.log('Error: ', error)
        // console.log('Response ', response)
        console.log('Storage info (body)...')
        console.log('body: ', body)
        // 
        
        console.log('Storage created... ')

        const storageId = body.data.id
        const objectName = storageId.split('/')[1]

        req.objectName = objectName

        return body


       
    })

    console.log("storageResult - (body)", JSON.stringify(storageResult, null, 4))

    return storageResult

    // unzipCallback(filePath, uploadUnzippedFile, req)
}


const createStorage = async (req, unzippedFilePath) => {

    const filePathParts = unzippedFilePath.split('/')
    const fileName = filePathParts[filePathParts.length-1]

    const projectId = req.body.project_id
    const fileItemId   = req.body.fileItemId;
    
    const fileItemName = fileName;

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
    //const projectId = params[params.length - 3];

    console.log(`Creating storage for ${fileName}... `)
    console.log(`resourceId: ${resourceId} `)
    console.log(`projectId: ${projectId} `)

    const incoming_oauth_token = {
        "access_token": req.body.oauth_token,
        "expires_in" : 3600
    }

    const incoming_oauth_token_2legged = {
        "access_token":  req.body.oauth2_token,
        "expires_in" : 3600
    }

    // getting the folder containing the zip file from the original api request
    const folder = req.folder

    console.log(`Creating storage based on ${fileItemName} `)


    const storageResult =  await betterCreateStorage(req, fileName )

    const storageId = storageResult.body.data.id

    return storageId

    



}

const uploadFile = async (data) => {

    const objects = new ObjectsApi()
    
    const {
        bucketKey ,
        objectName ,
        hostId,
        contentLength ,
        body,
        
        options,
        oauth2client,
        credentials 
        
    } = data
    
    console.log(`Uploading file: ${objectName} to bucketKey: ${bucketKey} ...  `)

    const uploadPromise = objects.uploadObject(
        bucketKey,
        objectName,
        contentLength,
        body,
        options,
        oauth2client,
        credentials

    )

    uploadPromise.then( function(result){
        console.log('Upload promise resolved')
        console.log(result)

    }, function(result){
        console.log("Upload promise rejected")
        console.log(result)
    })

    
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

    // console.log('req.body', req.body)

    const credentials = {
        // with Bearer we get the error:faultstring: 'Failed to Decode Token: policy(jwt-decode-HS256)',
        "access_token": req.body.oauth_token, 
        "expires_in" : 3600
    }
    // console.log('credentials', credentials )

    

    console.log(`Ready to upload ${unzippedFilePath}...`)
    // console.log("req", req.body)
    // Store file data chunks in this array
    let chunks = [];
    // Read file into stream.Readable
    let fileStream = fs.createReadStream(unzippedFilePath);
    fileStream.on('open', () => {
        console.log('Stream opened...');
    });

    fileStream.on('data', chunk => {
        // console.log('---------------------------------');
        // console.log(chunk);
        // console.log('---------------------------------');
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
            objectName: req.objectName,
            hostId: hostId,
            contentLength:  contentLength,
            body: fileBuffer, 
            options: {
                access: "readwrite"
            },
            oauth2client: req.oauth2_client, 
            credentials: credentials
    
        }
        return uploadFile(data)
    });

})

router.post('/da4revit/v1/upgrader/files/unzip', async (req, res, next) => {
    
    const fileItemId   = req.body.fileItemId;
    const fileItemName = req.body.fileItemName;

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
    const projectId = params[params.length - 3];

    const incoming_oauth_token = {
        "access_token": req.body.oauth_token,
        "expires_in" : 3600
    }

    const incoming_oauth_token_2legged = {
        "access_token":  req.body.oauth2_token,
        "expires_in" : 3600
    }

    // // adding here... 

    const items = new ItemsApi();
    console.log('Getting parent item folder.... (of zipped file)')

    console.log("projectId", projectId)
    console.log("resourceId", resourceId)
    console.log("req.oauth_client", req.oauth_client)
    console.log("incoming_oauth_token", incoming_oauth_token)
    

    const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, incoming_oauth_token);
    if(folder === null || folder.statusCode !== 200){
        console.log('failed to get the parent folder.');
        res.status(500).end('ailed to get the parent folder');
        return;
    }
    console.log('Getting parent item folder.... success')
    console.log('folder - of zip file... ', folder)
    console.log('Checking file format ....')

    // add the folder to the req object (?) for convenience

    req.folder = folder
    
    // const fileParams = fileItemName.split('.');
    // const fileExtension = fileParams[fileParams.length-1].toLowerCase();
    // // if( fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte'){
    // //     console.log('info: the file format is not supported');
    // //     res.status(500).end('the file format is not supported');
    // //     return;
    // // }

    // console.log('Checking file format .... OK')

    // console.log(`Creating storage based on ${fileItemName} `)

    // const storageInfo = await getNewCreatedStorageInfo(
    //     projectId, 
    //     folder.body.data.id, 
    //     fileItemName, 
    //     req.oauth_client, 
    //     incoming_oauth_token
    //     );
    // if (storageInfo === null ) {
    //     console.log('failed to create the storage');
    //     res.status(500).end('failed to create the storage');
    //     return;
    // }
    // const outputUrl = storageInfo.StorageUrl;
    // console.log('Creating storage..  OK')
    // console.log('Getting latest version info... ')

    // get the storage of the input item version

    const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, incoming_oauth_token);
    if (versionInfo === null ) {
        console.log('failed to get lastest version of the file');
        res.status(500).end('failed to get lastest version of the file');
        return;
    }
    const bim360Url = versionInfo.versionUrl; // aka. inputUrl 
    console.log('inputUrl: ', bim360Url)

    // try using the inputurl of the file from the autodesk storage
    let bim360UrlZip = bim360Url.replace('rvt', 'zip') 
    console.log('Attempting to unzip from URL: ', bim360UrlZip)
    
    let timestamp = Date.now()
    const downloadFilePath = `routes/data/streamedDownload_${timestamp}.zip`
    const url = bim360Url 

    let token = req.body.oauth_token
    console.log('Attempting to stream download from URL: ', url)
    // download(url, downloadFilePath, token, extractFiles, req)

    await download(url, downloadFilePath, token, extractFiles, req, extract=true)

    console.log("file downloaded" )
    // const hostId = folder.body.data.id
    // await createStorage(req, hostId)

    

    

    // const uploadData = {
    //     bucketKey : "wip.dm.prod",
    //     objectName : "sample_upload.rvt",
    //     contentLength : 1000 ,
    //     body : downloadFilePath,
    //     options : {},
    //     oauth2client : req.oauth_client,
    //     credentials : token

    // }

    // console.log('Attempting to upload file from location : ', downloadFilePath)

    // const uploadResult = uploadFile( uploadData )

    // console.log(uploadResult)

})










///////////////////////////////////////////////////////////////////////
/// NEW ROUTE - upgrade revit file to specified version using Design Automation 
/// for Revit API - python call version
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files/api', async (req, res, next) => {
    const fileItemId   = req.body.fileItemId;
    const fileItemName = req.body.fileItemName;

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
    const projectId = params[params.length - 3];

    const incoming_oauth_token = {
        "access_token": req.body.oauth_token,
        "expires_in" : 3600
    }

    const incoming_oauth_token_2legged = {
        "access_token":  req.body.oauth2_token,
        "expires_in" : 3600
    }
   



    console.log("incoming_oauth_token", incoming_oauth_token)

    console.log("req.oauth_client", req.oauth_client)

    
    console.log(fileItemId, fileItemName )
    try {
        const items = new ItemsApi();
        console.log('Getting parent item folder....')

        console.log("projectId", projectId)
        console.log("resourceId", resourceId)
        console.log("req.oauth_client", req.oauth_client)
        console.log("incoming_oauth_token", incoming_oauth_token)
        

        const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, incoming_oauth_token);
        if(folder === null || folder.statusCode !== 200){
            console.log('failed to get the parent folder.');
            res.status(500).end('ailed to get the parent folder');
            return;
        }
        console.log('Getting parent item folder.... success')
        console.log('Checking file format ....')
        
        const fileParams = fileItemName.split('.');
        const fileExtension = fileParams[fileParams.length-1].toLowerCase();
        if( fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte'){
            console.log('info: the file format is not supported');
            res.status(500).end('the file format is not supported');
            return;
        }

        console.log('Checking file format .... OK')

        console.log('Creating storage.. ')

        const storageInfo = await getNewCreatedStorageInfo(projectId, folder.body.data.id, fileItemName, req.oauth_client, incoming_oauth_token);
        if (storageInfo === null ) {
            console.log('failed to create the storage');
            res.status(500).end('failed to create the storage');
            return;
        }
        const outputUrl = storageInfo.StorageUrl;
        console.log('Creating storage..  OK')
        console.log('Getting latest version info... ')

        // get the storage of the input item version
        const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, incoming_oauth_token);
        if (versionInfo === null ) {
            console.log('failed to get lastest version of the file');
            res.status(500).end('failed to get lastest version of the file');
            return;
        }
        const inputUrl = versionInfo.versionUrl;
        console.log('Getting latest version info... success')

        console.log('Creating version body...')

        const createVersionBody = createBodyOfPostVersion(resourceId,fileItemName, storageInfo.StorageId, versionInfo.versionType);
        if (createVersionBody === null ) {
            console.log('failed to create body of Post Version');
            res.status(500).end('failed to create body of Post Version');
            return;
        }
        console.log('Creating version body... OK')
        

        ////////////////////////////////////////////////////////////////////////////////
        // use 2 legged token for design automation

        console.log('Getting 2 legged authentication for Design Automation')
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();

        console.log('Authenticated... ')
        console.log('Sending upgrade request... ')

        let upgradeRes = await upgradeFile(inputUrl, outputUrl, projectId, createVersionBody, fileExtension, incoming_oauth_token, incoming_oauth_token_2legged );
        if(upgradeRes === null || upgradeRes.statusCode !== 200 ){
            console.log('failed to upgrade the revit file');
            res.status(500).end('failed to upgrade the revit file');
            return;
        }
        console.log('Submitted the workitem: '+ upgradeRes.body.id);
        const upgradeInfo = {
            "fileName": fileItemName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status
        };
        res.status(200).end(JSON.stringify(upgradeInfo));

    } catch (err) {
        console.log('get exception while upgrading the file')
        res.status(500).end(err);
    }

})



///////////////////////////////////////////////////////////////////////
/// upgrade revit file to specified version using Design Automation 
/// for Revit API
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files', async (req, res, next) => {
    const fileItemId   = req.body.fileItemId;
    const fileItemName = req.body.fileItemName;

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
    const projectId = params[params.length - 3];

    try {
        const items = new ItemsApi();
        console.log('Getting parent item folder....')
        console.log('projectId, resourceId, req.oauth_client, req.oauth_token', projectId, resourceId, req.oauth_client, req.oauth_token)

        const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, req.oauth_token);
        if(folder === null || folder.statusCode !== 200){
            console.log('failed to get the parent folder.');
            res.status(500).end('ailed to get the parent folder');
            return;
        }
        console.log('Getting parent item folder.... success')
        console.log('Checking file format ....')
        
        const fileParams = fileItemName.split('.');
        const fileExtension = fileParams[fileParams.length-1].toLowerCase();
        if( fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte'){
            console.log('info: the file format is not supported');
            res.status(500).end('the file format is not supported');
            return;
        }
        console.log('Checking file format .... OK')

        console.log('Creating storage.. ')
        
        const storageInfo = await getNewCreatedStorageInfo(projectId, folder.body.data.id, fileItemName, req.oauth_client, req.oauth_token);
        if (storageInfo === null ) {
            console.log('failed to create the storage');
            res.status(500).end('failed to create the storage');
            return;
        }
        const outputUrl = storageInfo.StorageUrl;

        console.log('Creating storage..  OK')
        console.log('Getting latest version info... ')

        // get the storage of the input item version
        const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, req.oauth_token);
        if (versionInfo === null ) {
            console.log('failed to get lastest version of the file');
            res.status(500).end('failed to get lastest version of the file');
            return;
        }
        const inputUrl = versionInfo.versionUrl;
        console.log('Getting latest version info... success')

        

        console.log('Creating version body...')
        const createVersionBody = createBodyOfPostVersion(resourceId,fileItemName, storageInfo.StorageId, versionInfo.versionType);
        if (createVersionBody === null ) {
            console.log('failed to create body of Post Version');
            res.status(500).end('failed to create body of Post Version');
            return;
        }
        console.log('Creating version body... OK')
        
        ////////////////////////////////////////////////////////////////////////////////
        // use 2 legged token for design automation

        console.log('Getting 2 legged authentication for Design Automation')
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();
        console.log('Authenticated... ')
        console.log('Sending upgrade request... ')
        let upgradeRes = await upgradeFile(inputUrl, outputUrl, projectId, createVersionBody, fileExtension, req.oauth_token, oauth_token );
        if(upgradeRes === null || upgradeRes.statusCode !== 200 ){
            console.log('failed to upgrade the revit file');
            res.status(500).end('failed to upgrade the revit file');
            return;
        }
        console.log('Submitted the workitem: '+ upgradeRes.body.id);
        const upgradeInfo = {
            "fileName": fileItemName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status
        };
        res.status(200).end(JSON.stringify(upgradeInfo));

    } catch (err) {
        console.log('get exception while upgrading the file')
        res.status(500).end(err);
    }
});


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files/:source_file_url/folders/:destinate_folder_url', async (req, res, next) => {
    const sourceFileUrl = (req.params.source_file_url); 
    const destinateFolderUrl = (req.params.destinate_folder_url);
    if (sourceFileUrl === '' || destinateFolderUrl === '') {
        res.status(400).end('make sure sourceFile and destinateFolder have correct value');
        return;
    }
    const sourceFileParams = sourceFileUrl.split('/');
    const destinateFolderParams = destinateFolderUrl.split('/');
    if (sourceFileParams.length < 3 || destinateFolderParams.length < 3) {
        console.log('info: the url format is not correct');
        res.status(400).end('the url format is not correct');
        return;
    }

    const sourceFileType = sourceFileParams[sourceFileParams.length - 2];
    const destinateFolderType = destinateFolderParams[destinateFolderParams.length - 2];
    if (sourceFileType !== 'items' || destinateFolderType !== 'folders') {
        console.log('info: not supported item');
        res.status(400).end('not supported item');
        return;
    }

    const sourceFileId = sourceFileParams[sourceFileParams.length - 1];
    const sourceProjectId = sourceFileParams[sourceFileParams.length - 3];

    const destinateFolderId = destinateFolderParams[destinateFolderParams.length - 1];
    const destinateProjectId = destinateFolderParams[destinateFolderParams.length - 3];

    try {
        ////////////////////////////////////////////////////////////////////////////////
        // get the storage of the input item version
        const versionInfo = await getLatestVersionInfo(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (versionInfo === null) {
            console.log('error: failed to get lastest version of the file');
            res.status(500).end('failed to get lastest version of the file');
            return;
        }
        const inputUrl = versionInfo.versionUrl;

        const items = new ItemsApi();
        const sourceFile = await items.getItem(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (sourceFile === null || sourceFile.statusCode !== 200) {
            console.log('error: failed to get the current file item.');
            res.status(500).end('failed to get the current file item');
            return;
        }
        const fileName = sourceFile.body.data.attributes.displayName;
        const itemType = sourceFile.body.data.attributes.extension.type;

        const fileParams = fileName.split('.');
        const fileExtension = fileParams[fileParams.length-1].toLowerCase();
        if( fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte'){
            console.log('info: the file format is not supported');
            res.status(500).end('the file format is not supported');
            return;
        }
    
        ////////////////////////////////////////////////////////////////////////////////
        // create a new storage for the ouput item version
        const storageInfo = await getNewCreatedStorageInfo(destinateProjectId, destinateFolderId, fileName, req.oauth_client, req.oauth_token);
        if (storageInfo === null) {
            console.log('error: failed to create the storage');
            res.status(500).end('failed to create the storage');
            return;
        }
        const outputUrl = storageInfo.StorageUrl;

        const createFirstVersionBody = createBodyOfPostItem(fileName, destinateFolderId, storageInfo.StorageId, itemType, versionInfo.versionType)
        if (createFirstVersionBody === null) {
            console.log('failed to create body of Post Item');
            res.status(500).end('failed to create body of Post Item');
            return;
        }

        
        ////////////////////////////////////////////////////////////////////////////////
        // use 2 legged token for design automation
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();
        let upgradeRes = await upgradeFile(inputUrl, outputUrl, destinateProjectId, createFirstVersionBody,fileExtension, req.oauth_token, oauth_token);
        if (upgradeRes === null || upgradeRes.statusCode !== 200) {
            console.log('failed to upgrade the revit file');
            res.status(500).end('failed to upgrade the revit file');
            return;
        }
        console.log('Submitted the workitem: '+ upgradeRes.body.id);
        const upgradeInfo = {
            "fileName": fileName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status
        };
        res.status(200).end(JSON.stringify(upgradeInfo));

    } catch (err) {
        console.log('get exception while upgrading the file')
        res.status(500).end(err);
    }
});


///////////////////////////////////////////////////////////////////////
/// Cancel the file upgrade process if possible.
/// NOTE: This may not successful if the upgrade process is already started
///////////////////////////////////////////////////////////////////////
router.delete('/da4revit/v1/upgrader/files/:file_workitem_id', async(req, res, next) =>{

    const workitemId = req.params.file_workitem_id;
    try {
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();
        await cancelWorkitem(workitemId, oauth_token.access_token);
        let workitemStatus = {
            'WorkitemId': workitemId,
            'Status': "Cancelled"
        };

        const workitem = workitemList.find( (item) => {
            return item.workitemId === workitemId;
        } )
        if( workitem === undefined ){
            console.log('the workitem is not in the list')
            return;
        }
        console.log('The workitem: ' + workitemId + ' is cancelled')
        let index = workitemList.indexOf(workitem);
        workitemList.splice(index, 1);

        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        res.status(204).end();
    } catch (err) {
        res.status(500).end("error");
    }
})

///////////////////////////////////////////////////////////////////////
/// Query the status of the file
///////////////////////////////////////////////////////////////////////
router.get('/da4revit/v1/upgrader/files/:file_workitem_id', async(req, res, next) => {
    const workitemId = req.params.file_workitem_id;
    try {
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();        
        let workitemRes = await getWorkitemStatus(workitemId, oauth_token.access_token);
        res.status(200).end(JSON.stringify(workitemRes.body));
    } catch (err) {
        res.status(500).end("error");
    }
})


///////////////////////////////////////////////////////////////////////
///
///////////////////////////////////////////////////////////////////////
router.post('/callback/designautomation', async (req, res, next) => {
    // Best practice is to tell immediately that you got the call
    // so return the HTTP call and proceed with the business logic
    res.status(202).end();

    let workitemStatus = {
        'WorkitemId': req.body.id,
        'Status': "Success"
    };
    if (req.body.status === 'success') {
        const workitem = workitemList.find( (item) => {
            return item.workitemId === req.body.id;
        } )

        if( workitem === undefined ){
            console.log('The workitem: ' + req.body.id+ ' to callback is not in the item list')
            return;
        }
        let index = workitemList.indexOf(workitem);
        workitemStatus.Status = 'Success';
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        console.log("Post handle the workitem:  " + workitem.workitemId);

        const type = workitem.createVersionData.data.type;
        try {
            let version = null;
            if(type === "versions"){
                const versions = new VersionsApi();
                version = await versions.postVersion(workitem.projectId, workitem.createVersionData, req.oauth_client, workitem.access_token_3Legged);
            }else{
                const items = new ItemsApi();
                version = await items.postItem(workitem.projectId, workitem.createVersionData, req.oauth_client, workitem.access_token_3Legged);
            }
            if( version === null || version.statusCode !== 201 ){ 
                console.log('Falied to create a new version of the file');
                workitemStatus.Status = 'Failed'
            }else{
                console.log('Successfully created a new version of the file');
                workitemStatus.Status = 'Completed';
            }
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);

        } catch (err) {
            console.log(err);
            workitemStatus.Status = 'Failed';
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        }
        finally{
            // Remove the workitem after it's done
            workitemList.splice(index, 1);
        }

    }else{
        // Report if not successful.
        workitemStatus.Status = 'Failed';
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        console.log(req.body);
    }
    return;
})



module.exports = router;
