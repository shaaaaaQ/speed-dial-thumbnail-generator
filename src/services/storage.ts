let connection: Promise<IDBDatabase> | undefined;

function openDatabase() {
    if (connection) {
        return connection;
    }

    connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("dial-studio", 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore("data");
        };
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
                database.close();
                connection = undefined;
            };
            resolve(database);
        };
        request.onerror = () => {
            connection = undefined;
            reject(request.error);
        };
        request.onblocked = () => {
            connection = undefined;
            reject(new Error("他のタブが保存領域を使用しています。"));
        };
    });
    return connection;
}

export async function read<T>(key: string): Promise<T | undefined> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const readTransaction = database.transaction("data", "readonly");
        const request = readTransaction.objectStore("data").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function write(key: string, value: unknown) {
    const database = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const writeTransaction = database.transaction("data", "readwrite");
        writeTransaction.objectStore("data").put(value, key);
        writeTransaction.oncomplete = () => resolve();
        writeTransaction.onabort = writeTransaction.onerror = () => {
            reject(writeTransaction.error ?? new Error("保存に失敗しました。"));
        };
    });
}

export async function transaction<T>(
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore, setResult: (value: T) => void) => void,
): Promise<T> {
    const database = await openDatabase();
    return new Promise<T>((resolve, reject) => {
        const databaseTransaction = database.transaction("data", mode);
        let transactionResult: T;

        databaseTransaction.oncomplete = () => resolve(transactionResult);
        databaseTransaction.onabort = databaseTransaction.onerror = () => {
            reject(databaseTransaction.error ?? new Error("保存領域へのアクセスに失敗しました。"));
        };

        try {
            execute(databaseTransaction.objectStore("data"), value => {
                transactionResult = value;
            });
        } catch (error) {
            databaseTransaction.abort();
            reject(error);
        }
    });
}
