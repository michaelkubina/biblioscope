// some globals
var database = "opac-de-18"
var maxRecords = 12;

// Initialize an empty array to hold all document metadata
const discoveryJourney = [];

// author repository is just an associative array with the identifier as key and the name as value
var authorAuthorityRepository = [];

// takes the discovery journes to the next record request
/**
 * This function serves as the entry point for a new journey path
 * @param {string} ppn - The ppn (pica production number) of the resource
 */

async function visitRecord(ppn) {
    // flush the DOM
    $('main').empty();

    // current document
    currentDocument = await fetchRecordsBy(database, "ppn", ppn);
    currentDocumentMetadata = await extractMetadata(currentDocument);
    renderRecords(currentDocumentMetadata, "currentTitle", "primary");

    // render related documents by author
    for (author of currentDocumentMetadata[0].author) {
        if (author.nameIdentifier) {
            doc2 = await fetchRecordsBy(database, "nid", author.nameIdentifier);
        } else {
            doc2 = await fetchRecordsBy(database, "per", author.family + ", " + author.given);
        }
        doc2Metadata = await extractMetadata(doc2);
        renderRecords(doc2Metadata, "relatedByAuthor", "light", "Related works by the author(s)");
    }

    console.log(currentDocumentMetadata[0].topic);
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
            
            relatedDocumentsByTopic = await fetchRecordsBy(database, classificationType, classification);
            relatedDocumentsByTopicMetadata = await extractMetadata(relatedDocumentsByTopic);
            renderRecords(relatedDocumentsByTopicMetadata, "relatedByTopic", "secondary", "Related works by topic(s)");
        }
    }

    //console.log(authorAuthorityRepository);
}

/**
 * This function fetches record(s) by searching a certain field and returning the DOM object.
 * @param {string} database - The string representing the database to query.
 * @param {string} field - The string representing the pica field type to query.
 * @param {string} value - The string representing the actual search query.
 * @returns {XMLDocument} The DOM representing the result of the search query - can have multiple records.
 */

async function fetchRecordsBy(database, field, value) {
    const response = await fetch("https://sru.k10plus.de/" + database + "?version=1.1&operation=searchRetrieve&query=pica." + field + "%3D\"" + value + "\"&maximumRecords=" + maxRecords + "&recordSchema=mods36");
    const record = await response.text();
    //console.log(record);
    const parser = new DOMParser();
    var result = parser.parseFromString(record, "application/xml");
    //console.log(result);
    return result;
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
            "type": "",
            "author": [{
                "family": "",
                "given": "",
            }],
            "year": "",
            "topic":[],
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

        authorlist = [];

        for (j = 0; j < metadata[i].author.length; j++) {
            authorlist.push(metadata[i].author[j].family + ', ' + metadata[i].author[j].given);
        }

        $('div.' + anchor + '> div > div#nav-' + anchor + navTabIndex + '> div.row').append('\
        <div class="col">\
            <div class="card shadow text-bg-' + color + '" style="max-width: 540px;">\
                <div class="row g-0">\
                    <div class="col-md-12">\
                        <div class="card-header">\
                            <h4 class="text-end mb-0"><i class="bi bi-star"></i></h4>\
                        </div>\
                        <div class="card-body">\
                            <h5 class="card-title" style="cursor: pointer;" onclick="visitRecord(\'' + metadata[i].id + '\')">' + metadata[i].title + (metadata[i].subTitle ? ': ' + metadata[i].subTitle : '') + '</h5>\
                            <p class="card-text">' + metadata[i].year + '</p>\
                            <p class="card-text"><small class="text-body-secondary">' + authorlist.join(' / ') + '</small></p>\
                        </div>\
                        <div class="card-footer">\
                        ' + (metadata[i].tocLink ? '<a href="' + metadata[i].tocLink + '"><i class="bi bi-list-columns"></i></a>' : '') + '\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </div>'
            );

    }
}