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
/// NEW ROUTE - upgrade revit file to specified version using Design Automation 
/// for Revit API - python call version
///////////////////////////////////////////////////////////////////////

const fs = require('fs');
const zlib = require('zlib');
const DecompressZip = require('decompress-zip');

const http = require("http")

const request = require("request")

function _downloadFile(url, pathName) {
    return new Promise((resolve, reject) => {
      request.head(url, function(){
        request(url).pipe(fs.createWriteStream(pathName))
          .on('close', () => resolve(pathName))
          .on('error', error =>  reject(error))
      });
    })
  }

  const download = (url, dest, token, cb) => {
    const file = fs.createWriteStream(dest);
    console.log('Attempting download of: ', url)

    const reqOptions = {
        url: url,
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

    // close() is async, call cb after close completes
    file.on('finish', () => file.close(cb));

    // check for request errors
    sendReq.on('error', (err) => {
        fs.unlink(dest);
        return cb(err.message);
    });

    file.on('error', (err) => { // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return cb(err.message);
    });
};

const unzip = (file) => {

    let unzipper = new DecompressZip( file);

    let extractFilePath = 'routes/data'

    unzipper.extract({
        path: extractFilePath
    })
    unzipper.on('extract', function (log) {
        console.log('extract log ', log);
        // send the (first) file extracted as a download to the client
        //res.download(extractFilePath +'/'+ log[0].deflated).end("unzip endpoint called");
        res.status(200).end(inputUrl);
    });
}



const listFiles = () => {

    const dataFolder = 'routes/data'
    console.log('Files in local file system: ')
    fs.readdir(dataFolder, (err, files) => {
        files.forEach(file => {

            let f = file
            let filePath = dataFolder+'/'+f
            let stats = fs.statSync(filePath)
            let sizeInBytes = stats["size"]
            let sizeInMB = sizeInBytes/1000000

            console.log(file, sizeInMB+"MB");
        });  
        
        files.forEach(file => {
            
            let filePath = dataFolder+'/'+file
            if (filePath.includes(".zip")){
                console.log('Unzipping ' + filePath )
                unzip(filePath)
            }

        })

    });
}

router.post('/da4revit/v1/upgrader/files/unzip', async (req, res, next) => {
    
    // gunzip
    // const fileContents = fs.createReadStream('routes/data/revitfile.zip');
    // console.log(fileContents);
    // const unzippedFilePath = 'routes/data/revitfile.rvt'
    // const writeStream = fs.createWriteStream(unzippedFilePath);
    // const unzip = zlib.createGunzip();
    // fileContents.pipe(unzip).pipe(writeStream);
    // res.download(unzippedFilePath).end("unzip endpoint called");

    //////////

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

    // get the storage of the input item version


    const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, incoming_oauth_token);
    if (versionInfo === null ) {
        console.log('failed to get lastest version of the file');
        res.status(500).end('failed to get lastest version of the file');
        return;
    }
    const bim360Url = versionInfo.versionUrl;
    console.log('inputUrl: ', bim360Url)

    /////////
    let absoluteZipFilePath = 'routes/data/revitfile.zip'

    // try using the inputurl of the file from the autodesk storage
    let bim360UrlZip = bim360Url.replace('rvt', 'zip') 
    console.log('Attempting to unzip from URL: ', bim360UrlZip)
    let timestamp = Date.now()
    const downloadFilePath = `routes/data/streamedDownload_${timestamp}.zip`
    // let downloadedFile = _downloadFile(inputFileUrl, downloadFilePath )
    // console.log("downloadedFile: ", downloadedFile)

    const testImgUrl = "https://images.unsplash.com/photo-1494253109108-2e30c049369b"

    // const testZipUrl = "https://ww-emea-meptools.s3.eu-west-2.amazonaws.com/test/rac_advanced_sample_project.rvt+AWS+copy.zip"
    const testZipUrl = "https://ww-emea-meptools.s3.eu-west-2.amazonaws.com/test/LON_1+Fore+Street_Capital+Improvement_Citi.zip"
    // request(inputFileUrl).pipe(fs.createWriteStream(downloadFilePath))

    // unzip is successful using a zip file created locally (in MacOS -> compress file)
    // possibly unexpected 'zip' format when dealing with Autodesk CompositeDesign file
    const url = testZipUrl // bim360Url // 

    let token = req.body.oauth_token
    console.log('Attempting to stream download from URL: ', url)
    download(url, downloadFilePath, token, listFiles)

    // absoluteZipFilePath = downloadFilePath  // didnt work... nice try

    


    


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
