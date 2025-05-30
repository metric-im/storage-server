# Storage Server

Storage Server plugs into the metric componentry providing file management. It exports a web api on the front-end
normalizing get/put/delete across numerous file systems. It is nothing new or complicated.

~~~~plantuml
@startuml
allowmixing
package "Storage Provider" as Provider
package "Storage Client" as Client
package "storage server" as Server {
class StorageAPI
class StorageBridge
class RenderEngine
class AWSStorage
class StorjStorage
class DiskStorage
class RawRender
class NetworkImageRender
class StreamRender
StorageAPI -d-> StorageBridge
StorageAPI -d-> RenderEngine
AWSStorage -u-|> StorageBridge
StorjStorage -u-|> StorageBridge
DiskStorage -u-|> StorageBridge
RawRender -u-|> RenderEngine
NetworkImageRender -u-|> RenderEngine
StreamRender -u-|> RenderEngine
}
Provider <-u- StorageBridge
Client -d-> StorageAPI
@enduml
~~~~

If the image above doesn't render, open with metric wiki or paste the code into https://metric.im/uml/edit/

## Configuration
When instantiated, the storage server will connect to the requested backend service with credentials provided by
the host. We use environment variables

* STORAGE_PROFILE = storj|s3|disk|mongo
* STORAGE_CREDENTIALS = // key or stringified JSON or whatever is expected by the storage engine

## API Reference

URL path syntax uses /list to get or manage folder structure and /item to get, create, delete or update files

Access control is enforced at the account level. The requesting user must have read rights to get or list files,
write rights to create/update files or folder and owner rights to delete files or folders not owned by the user.

### GET /storage/list/{account}[/{path}[/...]]

| Attribute | Description                                                                                    |
|-----------|------------------------------------------------------------------------------------------------|
| account   | Top level organizational bucket                                                                |
| path      | Nested folders                                                                       |

Return a list of all items in the folder. If there are no items in the folder return and empty array. If
the folder doesn't exist return not found.

### PUT /storage/list/{account}[/{path}[/...]]

| Attribute | Description                     |
|-----------|---------------------------------|
| account   | Top level organizational bucket |
| path      | Nested folders                  |

Create the folder if it doesn't exist. Return an error if it does exist. Allow nested folders to be created
in a single request. For example PUT `/list/acme/top/one/two` will create folders top, one and two if these
folders and subfolders do not yet exist.

>NOTE: A POST to /list should probably work identically

### DELETE /storage/list/{account}[/{path}[/...]]

| Attribute | Description                                                                                    |
|-----------|------------------------------------------------------------------------------------------------|
| account   | Top level organizational bucket                                                                |
| path      | Nested folders                                                                       |

Remove the folder if it exists along with all folders and items in the folder.

### GET /storage/item/{account}[/{path}[/...]]/{fileName}][#render][?options]

| Attribute | Description                                                                                    |
|-----------|------------------------------------------------------------------------------------------------|
| account   | Top level organizational bucket                                                                |
| path      | arbitrary nested folders                                                                       |
| fileName | uniquely named blob of any file type                                                            |
| #render | indicates a rendering engine for special file handling. If not provided the raw file is returned |
| options | Options to be determined can be provided through the query string of the url request.            |

Return the last node in the request structure as a file. If the last node in the path is a folder,
not a file, return not found. Use /list to get the contents of folders.

The render engine follows the fileName. The architecture allows for many different plugin engines. This is used
to format the file data in some useful manner. If not provided, the file is returned raw. If the mime-type is
unknown, the extension of the file (if available) helps determine the format.

Mime-type is important for the requesting environment to display the file properly. Some rendering engines,
however, may deliver the file with a player. For example, a video file might be fetched with `#mediaplayer`.
this renders a video object on a web page and could be placed in an iframe. Or, a json file may be delivered
as a spread sheet download with '#csv.file'

### POST /storage/item/{account}[/{path}[/...]]/{fileName}][#render][?options]

Upload a file to the given account and folder path. Additional form fields containing atomic strings or numbers
will be saved in the `._i` meta file. If the file already exists, it will be replaced with the new upload. Properties
accompanying the new file will be merged with the existing properties. New values replace old values. Properties
not provided with the new upload will be retained. Properties may be updated by posting without a file attachment.

A render engine may be used on uploaded files. For example, `#networkImage` may automatically normalize all
image type files to png.

### PUT /storage/item/{account}[/{path}[/...]]/{fileName}][#render][?options]

Stage an upload. POST takes the same syntax as POST but does not provide the file itself. It instead just writes
the `._i` meta file and prepares and returns a url to use for background uploading.

>NOTE: This is a proposal. It may be necessary to deal with large background uploads. If a file can be uploaded
> without first being staged, that is preferable.

### DELETE /storage/item/{account}[/{path}[/...]]/{fileName}]

Deletes the referenced file from storage, or files if only a path is provided. A file means ALL files that have the
same root name as the file being deleted. So deleting `mycat.png` will further delete `mycat.png._i` and
`mycat.png.64x64.png` as well. Render engines may create additional files like this.

## File Tenets

* **Wildcards** - All requests support wildcards. For example `/2025/taxes_*` will return all files in a folder named 2025
that begin with `taxes_`. Wildcard search are implemented with regex. Complex regex phrases will need to be
URLEncoded.
* **Case** - The system should store and present the original case of a filename, however, matching is done case-insensitive.
A file stored on disk, for example, may be named MyCat.jpg. It will be rendered in lists as such. However, no other file
in the same folder may have the sequence of letters, "mycat.jpg".
* **Security** - Access Control pertains solely to the top-level account bucket. The current user must have read,
write, owner access for GET, POST, DELETE respectively.

### Meta Data
Every file has an accompanying meta data file which is the file name accompanied by "._i" (I for info
because some obnoxious company stole "meta" from the English language.) The
meta data file includes _created, _createdBy, _modified and many optional properties such as tags, dimensions, hash
code or description. In most rendering scenarios, no one would never see the _i file. 

```bash
/AcmeCorp/creative/blue_flowers.png
/AcmeCorp/creative/blue_flowers.png._i
/AcmeCorp/creative/orange_truck.png
/AcmeCorp/creative/orange_truck.png._i
/AcmeCorp/creative/InventoryList.json
/AcmeCorp/creative/InventoryList.json._i
/AcmeCorp/creative/archive/red_truck.png
/AcmeCorp/creative/archive/red_truck.png._i
```
On upload of new file, set:
* _created = now
* _createdBy = account.userId
* _hash = md5 hash of file bytes

On upload of existing file
* _modified = now
* _modifiedBy = account.userId
* _hash = md5 hash of file bytes

>**NOTE:** The choice to put the meta data into a sister file rather than attaching it to the content file or storing the
> data in a database is deliberate. It helps with portability without touching the original. There are benefits to other
> schemes. This model is chosen for the purposes of supporting metric componentry with file storage. There should be NO
> additional dependencies to a file stored by the metric storage server.

## Storage Engines

___(Note that only StorJ is implemented right now)___

### AWS S3

### StorJ

We use the S3 compatible interface provided by StorJ for convenience

### Mongo

Only use for situations requiring relatively small files and not too many of them. The database
is not very efficient for storing binary object which need to be translated into base64

### Disk

Easiest for small projects and prototype

## Render Engines

Render engines are used to streamline the use of the Storage Server in different environments. The syntax
of the render engine reference is hash-sign name followed by dot delimited strings that are passed as arguments
in the order given. 

___(Note that only #raw is implemented right now)___

### \#raw
This is the default, so the same as providing now render engine.

Returns the file as the mime-type defined in the meta file properties. If not available, choses the mime-type based
on extension.

### \#stream

### \#networkImage[.network]

This supports posting files for download to Meta, X, Taboola, etc. The engine ensures the image is transposed
according to the unique specification of the network host.

