use tower::ServiceBuilder;
use vercel_runtime::axum::VercelLayer;

#[tokio::main]
async fn main() -> Result<(), vercel_runtime::Error> {
    let router = knowledge_rpg::router()?;
    // Local development: a plain server that Vite proxies /api to.
    if let Ok(port) = std::env::var("LOCAL_PORT") {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port.parse::<u16>()?)).await?;
        axum::serve(listener, router).await?;
        return Ok(());
    }
    vercel_runtime::run(ServiceBuilder::new().layer(VercelLayer::new()).service(router)).await
}
