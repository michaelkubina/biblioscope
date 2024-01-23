// some globals
var database = "opac-de-18"
var maxRecords = 4;

// Initialize an empty array to hold all document metadata
const discoveryJourney = [];

// author repository is just an associative array with the identifier as key and the name as value
var authorAuthorityRepository = [];

// create IndexedDB database
var db = new Dexie("biblioscopeDatabase");
db.version(1).stores({
    documents: "ppn",
});

async function toggleFavorite(ppn) {
    const record = await db.documents.get({ 'ppn': ppn });
    console.log(record);
        record.isFavorite = !record.isFavorite;
        await db.documents.put(record);

    // change icon
    $('.favorite[data-ppn="' + ppn + '"]').toggleClass('bi-star').toggleClass('bi-star-fill');
}

async function toggleDeadEnd(ppn) {
    const record = await db.documents.get({ 'ppn': ppn });
    console.log(record);
    record.isDeadEnd = !record.isDeadEnd;
    await db.documents.put(record);

    // change icon
    $('.deadend[data-ppn="' + ppn + '"]').toggleClass('bi-x-octagon').toggleClass('bi-x-octagon-fill');
}

/**
 * This function takes an XMLDocument and returns an array of PPNs
 * @param {XMLDocument} xmlDocument - The fetched XMLDocument as a jsmf-xjson.
 * @returns {String[]} - A simple list of PPNs.
 */
function listRecords(xmlDocument) {
    recordList = [];

    // select all records
    records = xmlDocument.evaluateSRU('//record');

    // loop over all records
    for (let i = 0; i < records.snapshotLength; i++) {
        // grab the json string
        jsonString = records.snapshotItem(i).textContent;
        // make a json object from it
        const jsonObject = JSON.parse(jsonString);
        // add ppn to recordList
        recordList.push(jsonObject.ppn);
    }
    return recordList;
}

// takes the discovery journes to the next record request
/**
 * This function serves as the entry point for a new journey path
 * @param {string} ppn - The ppn (pica production number) of the resource
 */

async function visitRecord(ppn) {
    // flush the DOM
    $('main').empty();

    // query the SRU and retrieve the response records
    //queryResult = await fetchRecordsBy(database, "per", "fischer", "jsmf-xjson");
    // extract a list of just the ppn
    //recordIdentifierList = listRecords(queryResult);
    //addMetadataToDatabase(recordIdentifierList);

    //
    currentDocument = await fetchRecordsBy(database, "ppn", ppn, "mods36");
    currentDocumentMetadata = await extractMetadata(currentDocument);
    renderRecords(currentDocumentMetadata, "currentTitle", "primary");

    // render related documents by author
    for (author of currentDocumentMetadata[0].author) {
        if (author.nameIdentifier) {
            doc2 = await fetchRecordsBy(database, "nid", author.nameIdentifier, "mods36");
            doc2Metadata = await extractMetadata(doc2);
            renderRecords(doc2Metadata, "relatedByAuthor", "light", "Related works by the author(s)");
        }

        doc2 = await fetchRecordsBy(database, "per", author.family + ", " + author.given, "mods36");
        doc2Metadata = await extractMetadata(doc2);
        renderRecords(doc2Metadata, "relatedByAuthor", "light", "Related works by the author(s)");
    }

    //console.log(currentDocumentMetadata[0].topic);
    // render related documents by topic
    for (classificationType in currentDocumentMetadata[0].topic) {
        for (classification of currentDocumentMetadata[0].topic[classificationType]) {
            if (classificationType == "ddc") {
                classificationType = "sgd";
                //classification = classification.substr(0, 3);
            }
            if (classificationType == "ssgn") {
                classificationType = "ssg";
                //classification = classification.substr(0, 3);
            }
            if (classificationType == "sdnb") {
                classificationType = "sgr";
                //classification = classification.substr(0, 3);
            }
            
            relatedDocumentsByTopic = await fetchRecordsBy(database, classificationType, classification, "mods36");
            relatedDocumentsByTopicMetadata = await extractMetadata(relatedDocumentsByTopic);
            renderRecords(relatedDocumentsByTopicMetadata, "relatedByTopic", "secondary", "Related works by topic(s)");
        }
    }

    // render related documents by topic
    for (subjectType in currentDocumentMetadata[0].subject) {
        for (subject of currentDocumentMetadata[0].subject[subjectType]) {
            relatedDocumentsBySubject = await fetchRecordsBy(database, "slw", subject, "mods36");
            relatedDocumentsBySubjectMetadata = await extractMetadata(relatedDocumentsBySubject);
            renderRecords(relatedDocumentsBySubjectMetadata, "relatedBySubject", "primary", "Related works by subject(s)");
        }
    }

    //console.log(authorAuthorityRepository);
}

/**
 * This function fetches record(s) by searching a certain field and returning the DOM object.
 * @param {string} database - The string representing the database to query.
 * @param {string} field - The string representing the pica field type to query.
 * @param {string} value - The string representing the actual search query.
 * @param {string} schema - The string representing the in which schema records get returned.
 * @returns {XMLDocument} The DOM representing the result of the search query - can have multiple records.
 */

async function fetchRecordsBy(database, field, value, schema) {
    const response = await fetch("https://sru.k10plus.de/" + database + "?version=1.1&operation=searchRetrieve&query=pica." + field + "%3D\"" + value + "\"&maximumRecords=" + maxRecords + "&recordSchema=" + schema);
    const record = await response.text();
    //console.log(record);
    const parser = new DOMParser();
    var result = parser.parseFromString(record, "application/xml");
    //console.log(result);
    return result;
}

async function addMetadataToDatabase(recordIdentifierList) {
    for (const recordIdentifier of recordIdentifierList) {
        // check if ppn already in db
        if (await db.documents.get(recordIdentifier)) {
            console.log(recordIdentifier + " already in Database!");
            console.log(db.documents.get(recordIdentifier));
        } else {
            // add to db
            console.log("Adding metadata of " + recordIdentifier + " to Database!");
            currentDocument = await fetchRecordsBy(database, "ppn", recordIdentifier, "mods36");
            console.log(await currentDocument);
            currentDocumentMetadata = await extractMetadata(currentDocument);
        }
    }
}

/**
 * This function extracts the needed metadata of each record and returns an array of metadata objects.
 * @param {XMLDocument} xmlDocument - The XMLDocument containing the record(s).
 * @returns {Array.<{metadata}>} The array contains all records in a condensed metadata format.
 */

async function extractMetadata(xmlDocument) {
    // initialize empty result array
    result = []

    // save the fetched records context
    query = xmlDocument.evaluateSRU('//zs:query').snapshotItem(0).textContent;
    split = query.split('=');
    result.field = split[0].replace(/pica\./g, '');
    result.query = split[1].replace(/"/g, '');
    if (authorAuthorityRepository[result.query]) {
        result.title = authorAuthorityRepository[result.query];
    } else {
        result.title = result.query;
    }

    // todo: resolve fields with identifiers as values with their corresponding text if available
    // eg. GND-Number of author should be translated to name, GND-Number of topic should be translated to name
    // switch(result.field) {etc.}

    // loop over all result records
    records = xmlDocument.evaluateSRU('//zs:record');
    //console.log(records);

    for (let i = 0; i < records.snapshotLength; i++) {

        // Initialize an empty JSON object
        const metadata = {
            "id": null,
            "ppn": null,
            "type": "",
            "author": [{
                "family": "",
                "given": "",
            }],
            "year": "",
            "edition": "",
            "topic": [],
            "subject": [],
            "tags": {
                "isFavourite": false,
                "fromAuthority": false,
            },
            //"comment": {},
        };

        // set authoritive flag
        if (result.field == 'nid') {
            metadata.tags.fromAuthority = "true";
        }

        // xpath counts indices from 1
        let index = i + 1;

        var record = '(//zs:record)[' + index + ']';

        // get the id
        ppn = xmlDocument.evaluateSRU(record + '//mods:mods/mods:recordInfo/mods:recordIdentifier[@source="DE-627"]');
        metadata.id = ppn.snapshotItem(0).textContent;
        metadata.ppn = metadata.id;

        // get the type
        if (type = xmlDocument.evaluateSRU(record + '//mods:mods/mods:originInfo/mods:issuance')) {
            switch (type.snapshotItem(0).textContent) {
                case "monographic":
                    metadata.type = "book";
                    break;
                case "single unit":
                    metadata.type = "book";
                    break;
                case "multipart monograph":
                    metadata.type = "book";
                    break;
                case "continuing":
                    metadata.type = "volume";
                    break;
                case "serial":
                    metadata.type = "volume";
                    break;
                case "integrating resource":
                    metadata.type = "volume";
                    break;
                default:
                    metadata.type = "document";
                    break;
            }
        }

        // todo: create a CSL enabled JSON from the obtained metadata

        // get the title
        if (title = xmlDocument.evaluateSRU(record + '//mods:mods/mods:titleInfo/mods:title')) {
            metadata.title = title.snapshotItem(0).textContent;
        }

        // get the subtitle
        if (subTitle = xmlDocument.evaluateSRU(record + '//mods:mods/mods:titleInfo/mods:subTitle')) {
            metadata.subTitle = subTitle.snapshotItem(0).textContent;
        }

        // get the year
        if (year = xmlDocument.evaluateSRU(record + '//mods:mods/mods:originInfo[@eventType="publication"]/mods:dateIssued')) {
            metadata.year = year.snapshotItem(0).textContent;
        }

        // get the edition
        if (edition = xmlDocument.evaluateSRU(record + '//mods:mods/mods:originInfo/mods:edition')) {
            metadata.edition = edition.snapshotItem(0).textContent;
        }

        // get the tocLink
        if (tocLink = xmlDocument.evaluateSRU(record + '//mods:url[@displayLabel="Inhaltsverzeichnis"]'))
        {
            metadata.tocLink = tocLink.snapshotItem(0).textContent;
        }

        // get the cover image url and pick first match in case there are multiple
        if (cover = xmlDocument.evaluateSRU(record + '//mods:mods/mods:location/mods:url[@displayLabel="Cover"]')) {
            metadata.cover = cover.snapshotItem(0).textContent;
        }

        // get the authors
        if (authors = xmlDocument.evaluateSRU(record + '//mods:mods/mods:name[@type="personal"]')) {
            for (let i = 0; i < authors.snapshotLength; i++) {
                personal = {};
                let index = i + 1;
                // todo: switch-case the rolecodes and populate accordingly, like: switch(authors[i].evaluateSRU('//mods:roleTerm[@type="code"]').textContent)
                //if (given = xmlDocument.evaluateSRU('(//mods:mods/mods:name[@type="personal"])[' + index + ']/mods:namePart[@type="given"]')) {
                if (given = xmlDocument.evaluateSRU(record + '//mods:mods/mods:name[@type="personal"][' + index + ']/mods:namePart[@type="given"]')) {
                    personal.given = given.snapshotItem(0).textContent;
                }
                if (family = xmlDocument.evaluateSRU(record + '//mods:mods/mods:name[@type="personal"][' + index + ']/mods:namePart[@type="family"]')) {
                    personal.family = family.snapshotItem(0).textContent;
                }
                if (nameIdentifier = xmlDocument.evaluateSRU(record + '//mods:mods/mods:name[@type="personal"][' + index + ']/mods:nameIdentifier[starts-with(text(), "(DE-588)")]')) {
                    captureGroups = nameIdentifier.snapshotItem(0).textContent.match(/\(DE-588\)(\S+)/);
                    personal.nameIdentifier = captureGroups[1];
                }
                metadata.author[i] = personal;
                if (personal.nameIdentifier && !authorAuthorityRepository[personal.nameIdentifier]) {
                    authorAuthorityRepository[personal.nameIdentifier] = personal.family + ", " + personal.given;
                }
            }
        }

        // get a list of all used classifications
        if (classificationAttributes = xmlDocument.evaluateSRU(record + '//mods:mods/mods:classification/@authority')) {
            classificationList = [];
            for (let i = 0; i < classificationAttributes.snapshotLength; i++) {
                classificationList.push(classificationAttributes.snapshotItem(i).nodeValue);
            }

            // filters array for unique values
            classificationList = [...new Set(classificationList)];

            // iterate over all classifications
            for (item of classificationList) {
                classificationNodes = xmlDocument.evaluateSRU(record + '//mods:mods/mods:classification[@authority="' + item + '"]');
                metadata.topic[item] = [];
                for (let i = 0; i < classificationNodes.snapshotLength; i++) {
                    metadata.topic[item].push((classificationNodes.snapshotItem(i).textContent));
                }
            }
        }

        // get a list of all used subjects
        if (subjectAttributes = xmlDocument.evaluateSRU(record + '//mods:mods/mods:subject/@authority')) {
            subjectList = [];
            
            for (let i = 0; i < subjectAttributes.snapshotLength; i++) {
                subjectList.push(subjectAttributes.snapshotItem(i).nodeValue);
            }

            //console.log(subjectList);
            // filters array for unique values
            subjectList = [...new Set(subjectList)];

            // iterate over all classifications
            for (item of subjectList) {
                subjectNodes = xmlDocument.evaluateSRU(record + '//mods:mods/mods:subject[@authority="' + item + '"]/mods:topic');
                if (subjectNodes) {
                    metadata.subject[item] = [];
                    for (let i = 0; i < subjectNodes.snapshotLength; i++) {
                        metadata.subject[item].push((subjectNodes.snapshotItem(i).textContent));
                    }
                }
            }
        }

        if (!await db.documents.get(metadata.id)) {
            //await db.documents.add({'ppn': metadata.id, 'isFavorite': false, 'isDeadEnd': false, 'metadata': metadata });

            await db.documents.put(metadata);
        }

        result.push(metadata);
    }

    //console.log(result);
    return result;
}

/**
 * This function acts as a custom NSResolver function to make mods work, which does not use the xmlns attribute. It further expands to other namespaces for convenience.
 * @param {string} prefix - The prefix used in the xpath.
 * @returns {string || null} The url corresponding to the namespace.
 */

function NSResolverSRU(prefix) {
    const namespaces = {
        "mods": "http://www.loc.gov/mods/v3",
        "zs": "http://www.loc.gov/zing/srw/",
    };

    return namespaces[prefix] || null; // Return the namespace URI for the given prefix
}

/**
 * This function acts as a custom evaluation function, to make the evaluation calls on SRU results simpler.
 * @param {string} xpath - The XPath 1.0 expression.
 * @returns {array.<{XPathResult}> || null} The xpathresult.
 */

Document.prototype.evaluateSRU = function (xpath) {
    xpathresult = this.evaluate(xpath, this, NSResolverSRU, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    //console.log(xpathresult);
    //console.log(xpath + " - " + xpathresult.snapshotLength);

    // return null on empty result
    if (xpathresult.snapshotLength == 0) {
        return null;
    } else {
        return xpathresult;
    }
};

/**
 * This function places a container into the DOM with a tab-navigation and tab-panes. It populates the tab-panes with cards representing the found documents. Multiple calls on the same anchor stack to the metadata section.
 * @param {Array.<{metadata}>} metadata - The simplified metadata object from extractMetadata
 * @param {string} anchor - an arbitrary name for the anchor class of the container
 * @param {string} color - the color class name from bootstrap
 * @param {string} title - the title of the container
 */

async function renderRecords(metadata, anchor, color, title = "") {

    //console.log(metadata);

    // place a nav-tab only if there is no nav-tab already
    if ($('main div.' + anchor).length < 1) {
        $('main').append('\
        <div class="' + anchor + ' mb-4">\
            <h2 class="text-center">' + title + '</h2>\
            <nav>\
                <div class="nav nav-tabs mb-4" id="nav-tab" role="tablist">\
                </div>\
            </nav>\
            <div class="tab-content" id="nav-tabContent">\
            </div>\
        </div>'
        );
    }
    // todo: else set first navtab and tabpane active


    navTabIndex = $('main > div.' + anchor + ' div#nav-tab .nav-link').length;

    // add nav-tab
    $('main > div.' + anchor + ' div#nav-tab').append('\
    <button \
        class="nav-link' + (navTabIndex == 0 ? ' active' : '') + '" \
        id="nav-' + anchor + navTabIndex + '-tab" \
        data-bs-toggle="tab" \
        data-bs-target="#nav-' + anchor + navTabIndex + '" \
        type="button" role="tab" \
        aria-controls="nav-' + anchor + navTabIndex + '" \
        aria-selected="true">' + metadata.title + (metadata.field == "per" ? ' <i class="bi bi-exclamation-triangle-fill text-warning"></i>' : (metadata.field == "nid" ? ' <i class="bi bi-bank text-success"></i>' : "")) + '\
    </button > ');

    // add tab-pane
    $('main > div.' + anchor + ' div.tab-content').append('\
    <div class="tab-pane fade show' + (navTabIndex == 0 ? ' active' : '') + '" id="nav-' + anchor + navTabIndex + '" role="tabpanel" aria-labelledby="nav-' + anchor + navTabIndex + '-tab" tabindex="0">\
    ' + (metadata.field == "per" ? '<div class="alert alert-warning" role="alert">Attention! The results may contain works from other authors that share the same name. The search was performed as a free search, because there was no authoritive data available for this author.</div>' : '') + '\
        <div class="row row-cols-1 row-cols-md-4 g-4">\
        </div>\
    </div>\
    ');

    for (i = 0; i < metadata.length; i++) {

        var record = await db.documents.get({ 'ppn': metadata[i].id });

        authorlist = [];

        for (j = 0; j < record.author.length; j++) {
            authorlist.push(record.author[j].family + ', ' + record.author[j].given);
        }

        $('div.' + anchor + '> div > div#nav-' + anchor + navTabIndex + '> div.row').append('\
        <div class="col">\
            <div class="card shadow text-bg-' + color + '" style="max-width: 540px;">\
                <div class="row g-0">\
                    <div class="col-md-12">\
                        <div class="card-header">\
                            <h4 class="text-end mb-0">\
                            <i class="bi ' + (await record.isDeadEnd ? 'bi-x-octagon-fill' : 'bi-x-octagon') + ' deadend" data-ppn="' + record.ppn + '"></i>\
                            <i class="bi ' + (await record.isFavorite ? 'bi-star-fill' : 'bi-star') + ' favorite" data-ppn="' + record.ppn + '"></i>\
                            </h4>\
                        </div>\
                        <div class="card-body">\
                            <h5 class="card-title" style="cursor: pointer;" onclick="visitRecord(\'' + record.id + '\')">' + record.title + (record.subTitle ? ': ' + record.subTitle : '') + '</h5>\
                            <p class="card-text">' + record.edition + '<br>' + record.year + '</p>\
                            <p class="card-text"><small class="text-body-secondary">' + authorlist.join(' / ') + '</small></p>\
                        </div>\
                        <div class="card-footer">\
                        ' + (record.tocLink ? '<a href="' + record.tocLink + '"><i class="bi bi-list-columns"></i></a>' : '') + '\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </div>'
        );

        // add an event listener for the onclick toggle event, in order to use async functions properly
        $('.favorite[data-ppn="' + record.ppn + '"]').last().on('click', async function () {
            // Call the handleClick function and pass the button element
            await toggleFavorite($(this).attr('data-ppn'));
        });

        // add an event listener for the onclick toggle event, in order to use async functions properly
        $('.deadend[data-ppn="' + record.ppn + '"]').last().on('click', async function () {
            // Call the handleClick function and pass the button element
            await toggleDeadEnd($(this).attr('data-ppn'));
        });
    }
}

