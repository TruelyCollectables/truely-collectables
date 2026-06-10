import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen">

      <section className="flex flex-col items-center justify-center py-20">

        <Image
          src="/logo.png"
          alt="Truely Collectables"
          width={200}
          height={200}
        />

        <h1 className="text-6xl font-bold mt-6">
          TRUELY COLLECTABLES
        </h1>

        <p className="text-xl mt-4">
          Premium Sports Cards & Collectibles
        </p>

        <button className="mt-8 px-8 py-4 border rounded-lg">
          Shop Now
        </button>

      </section>

      <section className="max-w-6xl mx-auto p-8">

        <h2 className="text-3xl font-bold mb-8">
          Featured Categories
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

          <div className="border p-6 text-center">
            Baseball
          </div>

          <div className="border p-6 text-center">
            Football
          </div>

          <div className="border p-6 text-center">
            Basketball
          </div>

          <div className="border p-6 text-center">
            Hockey
          </div>

        </div>

      </section>

    </main>
  );
}